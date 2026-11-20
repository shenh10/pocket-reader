import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {prepareNativePage} from '../scripts/native-pages.mjs';
import {localPageUrl,routeFromLink} from '../shared/routes.js';
const indexes=new Set(['index.html','ai-infra-board/index.html','nvidia-docs/index.html','nvidia-docs/kernels/index.html']);
test('native output names actual documents and preserves external and fragment links',()=>{
  const html=prepareNativePage('<head></head><a href="ai-infra-board/?date=2026-11-20&amp;view=day#top">daily</a><a href="https://example.org/">external</a><a href="#top">jump</a>', 'index.html',indexes);
  assert.ok(html.includes('href="ai-infra-board/index.html?date=2026-11-20&amp;view=day#top"'));
  assert.ok(html.includes('href="https://example.org/"'));
  assert.ok(html.includes('href="#top"'));
  assert.ok(prepareNativePage('<a href="../">up</a>', 'nvidia-docs/kernels/index.html',indexes).includes('href="../index.html"'));
});
test('legacy native directories recover before resolving the wrong root assets',()=>{
  const html=prepareNativePage('<head><link href="shared/home.css"></head>', 'index.html',indexes);
  const script=html.match(/<script data-native-directory-redirect>(.*?)<\/script>/)[1];
  for(const base of ['https://localhost/','capacitor://localhost/','http://localhost/native/']) {
    for(const dir of ['ai-infra-board/','ai-infra-board','nvidia-docs/kernels/']) {
      const href=new URL(dir+'?date=2026-11-20#top',base).href;let redirected;
      vm.runInNewContext(script,{URL,location:{href,replace:v=>redirected=v}});
      const expected=new URL(href);expected.pathname=expected.pathname.replace(/\/?$/,'/')+'index.html';
      assert.equal(redirected,expected.href);
    }
    let redirected=false;vm.runInNewContext(script,{URL,location:{href:base,replace:()=>redirected=true}});assert.equal(redirected,false);
  }
  assert.ok(html.indexOf('data-native-directory-redirect')<html.indexOf('shared/home.css'));
});
test('native tabs and notification targets resolve explicit HTML, while public links stay unchanged',()=>{
  for(const base of ['https://localhost/','capacitor://localhost/']) {
    assert.equal(localPageUrl('ai-infra-board/?date=2026-11-20',base,true).href,base+'ai-infra-board/index.html?date=2026-11-20');
    assert.equal(routeFromLink('pocketreader://daily?date=2026-11-20',base,true),base+'ai-infra-board/index.html?date=2026-11-20');
    assert.equal(localPageUrl('https://example.org/',base,true).href,'https://example.org/');
  }
  assert.equal(localPageUrl('ai-infra-board/','https://example.org/pocket-reader/').href,'https://example.org/pocket-reader/ai-infra-board/');
});
