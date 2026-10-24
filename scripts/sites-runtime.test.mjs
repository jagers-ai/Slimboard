// Exercise the production Worker runtime, not Node's more permissive APIs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Miniflare } from 'miniflare';
const compile = path => ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } }).outputText;
test('Worker analysis, private accounting and encrypted result receipt work together', async () => {
  const worker = new Miniflare({ compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], modulesRoot: '/', modules: [
      {type:'ESModule',path:'/usage.mjs',contents:compile('lib/openai-usage.ts')},
      {type:'ESModule',path:'/analysis.mjs',contents:compile('lib/openai-ocr.ts').replace('./openai-usage.ts','./usage.mjs')},
      {type:'ESModule',path:'/recovery.mjs',contents:compile('lib/analysis-recovery.ts')},
      {type:'ESModule',path:'/index.mjs',contents:`
import {analyzeWithOpenAI} from './analysis.mjs';
import {sealRecovery,openRecovery} from './recovery.mjs';
export default {async fetch(){
  const result=await analyzeWithOpenAI(Buffer.from([255,216,255,224]),'image/jpeg',{
    apiKey:'synthetic-test-only',fetch:async(url,options)=>{
      // Constructing a real Worker Request catches unsupported request options.
      const request=new Request(url,options);
      if(request.redirect!=='manual') throw Error('Unexpected redirect policy');
      return Response.json({status:'completed',model:'gpt-6.1-sol',service_tier:'default',
        usage:{input_tokens:20,output_tokens:10,total_tokens:30},
        output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({title:'test',rawText:'test',summary:'test',keywords:['test']})}]}]});
    }});
  const receipt=sealRecovery(result.analysis,'fixture-secret');
  return Response.json({analysis:openRecovery(receipt,'fixture-secret'),accounted:result.accounting.recorded});
}}`},
    ].sort((a,b)=>a.path==='/index.mjs'?-1:b.path==='/index.mjs'?1:0),
  });
  try {
    const db=await worker.getD1Database('DB');
    await db.prepare('CREATE TABLE openai_usage (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, record TEXT NOT NULL)').run();
    const response=await worker.dispatchFetch('http://localhost/');
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.analysis.title,'test');assert.equal(result.accounted,true);
    const rows=await db.prepare('SELECT record FROM openai_usage').all();
    assert.equal(rows.results.length,1);
    const record=JSON.parse(rows.results[0].record);
    assert.equal(record.status,'completed');assert.equal(record.usage.totalTokens,30);
    assert(!rows.results[0].record.includes('fixture-secret'));
  } finally {await worker.dispose();}
});
