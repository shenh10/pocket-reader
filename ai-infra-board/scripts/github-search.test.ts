import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fetchMergedSearch} from '../src/server/github-search';
import {localDateForTimestamp} from '../src/server/date';
import type {RepositoryRecord} from '../src/shared/types';
const repo: RepositoryRecord={id:1,fullName:'org/repo',owner:'org',name:'repo',displayName:'Repo',homepageUrl:null,description:null,enabled:true,importanceWeight:3};
function pull(number:number,mergedAt='2026-01-01T01:00:00Z') {
  return {__typename:'PullRequest',databaseId:number,number,title:'Fix cache',body:'',url:`https://github.com/org/repo/pull/${number}`,mergedAt,createdAt:mergedAt,updatedAt:mergedAt,baseRefName:'main',headRefName:'fix',additions:1,deletions:0,changedFiles:1,mergeCommit:null,author:null,labels:{nodes:[]},files:{totalCount:1,nodes:[{path:'src/cache.ts',additions:1,deletions:0,changeType:'MODIFIED'}]}};
}
function response(issueCount:number,nodes:unknown[],hasNextPage=false,endCursor:string|null=null) {
 return new Response(JSON.stringify({data:{search:{issueCount,nodes,pageInfo:{hasNextPage,endCursor}}}}));
}
async function mockFetch(fn:typeof fetch,run:()=>Promise<void>) {const old=globalThis.fetch;const cache=process.env.GITHUB_BACKFILL_CACHE;delete process.env.GITHUB_BACKFILL_CACHE;globalThis.fetch=fn;try{await run();}finally{globalThis.fetch=old;if(cache)process.env.GITHUB_BACKFILL_CACHE=cache;else delete process.env.GITHUB_BACKFILL_CACHE;}}
const start=new Date('2026-01-01T00:00:00Z'),end=new Date('2026-01-02T00:00:00Z');
test('paginates all PRs and preserves file samples',async()=>{
 let calls=0;await mockFetch(async(_url,options)=>{const after=JSON.parse(String(options?.body)).variables.after;assert.equal(after,calls?'next':null);calls++;return response(2,[pull(calls)],calls===1,'next');},async()=>{const data=await fetchMergedSearch(start,end,[repo],'test');assert.equal(calls,2);assert.equal(data.pullRequests.length,2);assert.equal(data.coverage[0].expected,2);assert.deepEqual((data.pullRequests[0].raw as {files:unknown}).files,data.pullRequests[0].files);});
});
test('splits saturated searches before pagination can truncate them',async()=>{
 let calls=0;await mockFetch(async()=>{calls++;return calls===1?response(1000,[]):response(1,[pull(calls,calls===2?'2026-01-01T01:00:00Z':'2026-01-01T20:00:00Z')]);},async()=>{const data=await fetchMergedSearch(start,end,[repo],'test');assert.equal(data.pullRequests.length,2);assert.equal(data.coverage.length,2);});
});
test('rejects missing nodes and count mismatches rather than publishing partial success',async()=>{
 await mockFetch(async()=>response(1,[null]),async()=>{await assert.rejects(fetchMergedSearch(start,end,[repo],'test'),/Invalid or unavailable/);});
 await mockFetch(async()=>response(2,[pull(1)]),async()=>{await assert.rejects(fetchMergedSearch(start,end,[repo],'test'),/expected 2, got 1/);});
 await mockFetch(async()=>response(1,[{...pull(1),__typename:'Issue'}]),async()=>{await assert.rejects(fetchMergedSearch(start,end,[repo],'test'),/Invalid or unavailable/);});
});
test('bypasses cache for a still open day',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ai-infra-cache-'));
 const a=new Date();a.setUTCHours(0,0,0,0);const b=new Date(a.getTime()+86400000);
 const stamp=(d:Date)=>d.toISOString().slice(0,19)+'Z';
 const q=`repo:org/repo is:pr is:merged merged:${stamp(a)}..${stamp(new Date(b.getTime()-1000))} sort:created-asc`;
 await fs.writeFile(path.join(dir,createHash('sha256').update(q).digest('hex')+'.json'),JSON.stringify({query:q,expected:1,nodes:[pull(1,stamp(a))]}));
 let calls=0;try{await mockFetch(async()=>{calls++;return response(0,[]);},async()=>{process.env.GITHUB_BACKFILL_CACHE=dir;const data=await fetchMergedSearch(a,b,[repo],'test');assert.equal(calls,1);assert.equal(data.pullRequests.length,0);});}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('assigns a UTC late afternoon merge to the following Shanghai day',()=>{
 assert.equal(localDateForTimestamp('2026-11-15T16:00:00Z'),'2026-11-16');
 assert.equal(localDateForTimestamp('2026-11-15T15:59:59Z'),'2026-11-15');
});
