import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { RepositoryRecord } from "../shared/types";
import type { FetchedPullRequest } from "./github";
import { analyzePullRequest } from "./intelligence";

const QUERY = `query($q:String!,$after:String) {
  search(query:$q,type:ISSUE,first:50,after:$after) {
    issueCount pageInfo {hasNextPage endCursor}
    nodes { __typename ... on PullRequest {
      databaseId number title body url mergedAt createdAt updatedAt baseRefName headRefName
      additions deletions changedFiles mergeCommit {oid} author {login avatarUrl}
      labels(first:100) {nodes {name}}
      files(first:30) {totalCount nodes {path additions deletions changeType}}
    }}
  }
}`;
interface Pull {
  __typename?: string; databaseId: number; number: number; title: string; body: string; url: string;
  mergedAt: string; createdAt: string; updatedAt: string; baseRefName: string; headRefName: string;
  additions: number; deletions: number; changedFiles: number;
  mergeCommit: {oid: string} | null; author: {login: string; avatarUrl: string} | null;
  labels: {nodes: {name: string}[]};
  files: {totalCount: number; nodes: {path: string; additions: number; deletions: number; changeType: string}[]};
}
interface Page {issueCount: number; pageInfo: {hasNextPage: boolean; endCursor: string | null}; nodes: unknown[]}
export interface Coverage {repo: string; start: string; end: string; expected: number; fetched: number; fileSamples: number}

function validPull(value: unknown): value is Pull {
  if (!value || typeof value !== "object") return false;
  const p = value as Pull;
  return (p.__typename === undefined || p.__typename === "PullRequest") &&
    Number.isInteger(p.number) && p.number > 0 && Number.isInteger(p.databaseId) &&
    typeof p.title === "string" && typeof p.body === "string" &&
    typeof p.url === "string" && /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(p.url) &&
    Number.isFinite(Date.parse(p.mergedAt)) && Array.isArray(p.labels?.nodes) &&
    p.labels.nodes.every(l => l && typeof l.name === "string") &&
    Number.isInteger(p.files?.totalCount) && Array.isArray(p.files?.nodes) &&
    p.files.nodes.every(f => f && typeof f.path === "string");
}
function stamp(date: Date): string {return date.toISOString().slice(0,19)+"Z";}
async function request(q: string, after: string | null, token: string): Promise<Page> {
  for(let attempt=0;attempt<4;attempt++) {
    try {
      const response = await fetch("https://api.github.com/graphql", {
        method:"POST", headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
        body:JSON.stringify({query:QUERY,variables:{q,after}}), signal:AbortSignal.timeout(60000)
      });
      const body = await response.json() as {data?:{search:Page};errors?:{message:string}[]};
      if(!response.ok || body.errors?.length || !body.data?.search) throw new Error(`GitHub GraphQL ${response.status}: ${body.errors?.map(e=>e.message).join('; ') ?? 'missing search data'}`);
      return body.data.search;
    } catch(error) {
      if(attempt===3) throw error;
      await new Promise(resolve=>setTimeout(resolve,2000*2**attempt));
    }
  }
  throw new Error("unreachable");
}

export async function fetchMergedSearch(start: Date,end: Date,repos: RepositoryRecord[],token: string): Promise<{pullRequests:FetchedPullRequest[];warnings:string[];coverage:Coverage[]}> {
  const all:FetchedPullRequest[]=[];const coverage:Coverage[]=[];
  const cacheRoot=process.env.GITHUB_BACKFILL_CACHE;
  for(const repo of repos) {
    const map = new Map<number,Pull>();
    async function window(a:Date,b:Date):Promise<void> {
      const q=`repo:${repo.fullName} is:pr is:merged merged:${stamp(a)}..${stamp(new Date(b.getTime()-1000))} sort:created-asc`;
      // Open windows and the preceding 24 hours bypass checkpoints to include late search indexing.
      const cache=cacheRoot && b.getTime() <= Date.now()-86400000 ? path.join(cacheRoot,createHash('sha256').update(q).digest('hex')+'.json') : null;
      let nodes:Pull[]=[];let expected=0;let cacheHit=false;
      if(cache) {
        try {const saved=JSON.parse(await fs.readFile(cache,'utf8')) as {query:string;expected:number;nodes:Pull[]};
          if(saved.query===q&&Number.isInteger(saved.expected)&&Array.isArray(saved.nodes)&&saved.expected===saved.nodes.length&&saved.nodes.every(p=>validPull(p)&&new Date(p.mergedAt)>=a&&new Date(p.mergedAt)<b)){nodes=saved.nodes;expected=saved.expected;cacheHit=true;}
        }catch{ /* no completed checkpoint */ }
      }
      if(!cacheHit) {
        let page=await request(q,null,token);expected=page.issueCount;
        if(expected>=1000) {
          const mid=new Date(Math.floor((a.getTime()+b.getTime())/2000)*1000);
          if(mid<=a||mid>=b) throw new Error(`Search saturation in ${q}`);
          await window(a,mid);await window(mid,b);return;
        }
        while(true) {
          if (!Array.isArray(page.nodes) || !page.nodes.every(validPull)) throw new Error(`Invalid or unavailable PullRequest node: ${q}`);
          nodes.push(...page.nodes);
          if(!page.pageInfo.hasNextPage)break;
          if (!page.pageInfo.endCursor) throw new Error(`Missing search cursor: ${q}`);
          page=await request(q,page.pageInfo.endCursor,token);
          await new Promise(resolve=>setTimeout(resolve,150));
        }
        // Search may change while fetching today's window. A mismatch is a failure, never a successful empty snapshot.
        const unique=new Map(nodes.map(p=>[p.number,p]));nodes=[...unique.values()];
        if(nodes.length!==expected)throw new Error(`${repo.fullName}: expected ${expected}, got ${nodes.length}, ${stamp(a)}..${stamp(b)}`);
        if(nodes.some(p=>!p.mergedAt || new Date(p.mergedAt)<a || new Date(p.mergedAt)>=b))throw new Error(`Out-of-window GitHub search result: ${q}`);
        if(cache){await fs.mkdir(path.dirname(cache),{recursive:true});await fs.writeFile(cache,JSON.stringify({query:q,expected,nodes}));}
      }
      nodes.forEach(p=>map.set(p.number,p));
      const item={repo:repo.fullName,start:stamp(a),end:stamp(b),expected,fetched:nodes.length,fileSamples:nodes.filter(p=>p.files.totalCount>p.files.nodes.length).length};
      coverage.push(item); console.log('[coverage] '+JSON.stringify(item));
    }
    // Weekly windows keep requests bounded, cacheable, and below Search's 1000-result cap in most repos.
    for(let a=new Date(start);a<end;){const b=new Date(Math.min(a.getTime()+7*86400000,end.getTime()));await window(a,b);a=b;}
    for(const pr of map.values()) {
      const labels=pr.labels.nodes.map(l=>l.name);const files=pr.files.nodes;
      const analysis=analyzePullRequest({...pr,labels,files},repo);
      all.push({repoFullName:repo.fullName,number:pr.number,githubId:pr.databaseId,title:pr.title,body:pr.body,url:pr.url,
        apiUrl:`https://api.github.com/repos/${repo.fullName}/pulls/${pr.number}`,author:pr.author?.login??null,authorAvatarUrl:pr.author?.avatarUrl??null,
        mergedAt:pr.mergedAt,createdAt:pr.createdAt,updatedAt:pr.updatedAt,baseRef:pr.baseRefName,headRef:pr.headRefName,mergeCommitSha:pr.mergeCommit?.oid??null,
        additions:pr.additions,deletions:pr.deletions,changedFiles:pr.changedFiles,labels,files,
        category:analysis.category,importance:analysis.importance,importanceReason:analysis.importanceReason,learningComment:analysis.learningComment,evaluation:analysis.evaluation,
        raw:{...pr,files,fileListComplete:pr.files.totalCount===files.length,source:'github-graphql-search'}});
    }
  }
  return {pullRequests:all,warnings:[],coverage};
}
