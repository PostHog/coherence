import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile, mkdir, rm, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpProject, cleanup } from "./_helpers.ts";
import { loadConfig } from "../src/config.ts";
import { captureReceiptInputs, beginReceipt, finishReceipt, listReceipts, readReceipt, receiptCanonical, receiptHash, receiptWorkProblem } from "../src/evidence/receipts.ts";
const CLI = join(dirname(fileURLToPath(import.meta.url)),"..","src","cli.ts");
const git = (root: string, ...args: string[]) => execFileSync("git",args,{cwd:root,encoding:"utf8"});
function childEnv() { const env: NodeJS.ProcessEnv = { ...process.env, COHERENCE_SESSION: "" }; delete env.NODE_TEST_CONTEXT; return env; }
function cli(root: string, ...args: string[]) {
  const r = spawnSync(process.execPath,[CLI,...args],{cwd:root,encoding:"utf8",env:childEnv(),timeout:30000});
  assert.ifError(r.error); return { code:r.status, out:r.stdout, err:r.stderr };
}
async function project() {
  const root = await tmpProject({
    ".gitignore": ".coherence/verification/\n.coherence/status.json\n.coherence/verify-jobs.json\n",
    "coherence.config.json": JSON.stringify({codeExt:["js"],typecheck:[],test:[process.execPath,"--test","--test-reporter=tap","--test-name-pattern"],testMatch:"ok [0-9]+ - receipt executable control",oracleExecution:"serial"}),
    "project.spec.md": '# Receipt fixture\n\n## works when\n\n- passes test "receipt executable control"\n\n## why\n\nAn actual assertion must execute.\n',
    "policy.js": 'export const value = 42;\n',
    "policy.test.js": 'import test from "node:test"; import assert from "node:assert/strict"; import {value} from "./policy.js"; test("receipt executable control", () => assert.equal(value,42));\n',
    "package.json": '{"type":"module"}\n',
  });
  git(root,"init","-q");git(root,"config","user.email","receipts@invalid.example");git(root,"config","user.name","Receipt test");
  git(root,"add",".");git(root,"commit","-qm","fixture");return root;
}
function runReceipt(root: string, ...args: string[]) {
  const r = cli(root,"verify","--receipt",...args); assert.equal(r.code,0,r.out+r.err);
  const id=r.out.match(/receipt: (verification:sha256-[a-f0-9]{64})/)?.[1];assert.ok(id,r.out);return id;
}
const success = {outcome:"completed" as const,exitCode:0,failures:0,pending:0,onramp:false,observations:[{node:"fixture",claim:'passes test "case"',kind:"pass" as const,executed:true}]};

test("receipts — raw executed results survive reruns without borrowing sticky passes", async () => {
 const root=await project();try {
  const cfg=await loadConfig(root), first=runReceipt(root), r=readReceipt(cfg,first,true);
  assert.deepEqual(r.problems,[]);assert.equal(r.receipt.observations[0].executed,true);
  const before=await readFile(join(root,r.files.find(p=>p.includes('/receipts/'))!));
  const second=runReceipt(root);assert.notEqual(first,second);assert.deepEqual(await readFile(join(root,r.files.find(p=>p.includes('/receipts/'))!)),before);
  const fast=runReceipt(root,"--fast"), f=readReceipt(cfg,fast);
  assert.equal(f.receipt.observations[0].kind,"skip");assert.ok(f.problems.length);
  const status=JSON.parse(await readFile(join(root,'.coherence/status.json'),'utf8'));assert.equal(status.verify.claims[0].kind,"pass");
  assert.equal(listReceipts(cfg).completed.length,3);
 }finally{await cleanup(root);}
});

test("receipts — explicit work binding and selected files reconstruct in a fresh clone", async () => {
 const root=await project();let clone="";try {
  let r=cli(root,"work","create","verify policy","--id","wrk-receipt","--success","policy asserts 42","--risk","low","--authority","user-directed","--granted-by","user","--boundary","fixture","--session","worker");assert.equal(r.code,0,r.out+r.err);
  const id=runReceipt(root,"--work","wrk-receipt","--session","worker");const cfg=await loadConfig(root);
  assert.equal(receiptWorkProblem(cfg,id.replace('verification:',''),"wrk-receipt"),null);
  r=cli(root,"work","close","wrk-receipt","completed","--because","assertion ran","--evidence",id,"--session","worker");assert.equal(r.code,0,r.out+r.err);
  r=cli(root,"consequence","add",id,"verifies","work:wrk-receipt","--evidence","Named assertion checks the sole work criterion against these unchanged outputs","--session","reviewer");assert.equal(r.code,0,r.out+r.err);
  const view=JSON.parse(cli(root,"orient","--json").out);assert.deepEqual(view.consequences.unverifiedCompletedWork,[]);
  const files=readReceipt(cfg,id).files;git(root,"add",".coherence/work",".coherence/consequences");git(root,"add","-f",...files);git(root,"commit","-qm","retain selected evidence");
  clone=await tmpProject();git(root,"clone","-q",root,clone);
  assert.deepEqual(readReceipt(await loadConfig(clone),id,true).problems,[]);
  assert.deepEqual(JSON.parse(cli(clone,"orient","--json").out).consequences.unverifiedCompletedWork,[]);
  await rm(join(clone,files.find(p=>p.includes('/artifacts/'))!));
  assert.throws(()=>readReceipt({...cfg,root:clone},id));
  assert.deepEqual(JSON.parse(cli(clone,"orient","--json").out).consequences.unverifiedCompletedWork,["wrk-receipt"]);
 }finally{await cleanup(root);if(clone)await cleanup(clone);}
});

test("receipts — changed inputs, index, unrelated work and configuration never borrow current evidence", async () => {
 const root=await project();try {
  const cfg=await loadConfig(root), id=runReceipt(root);
  assert.match(receiptWorkProblem(cfg,id.replace('verification:',''),"other")!,/work definition/);
  await writeFile(join(root,"policy.js"),'export const value = 43;\n');
  assert.ok(readReceipt(cfg,id,true).problems.some(p=>p.includes('current repository')));
  assert.ok(readReceipt({...cfg,oracleExecution:"serial", testMatch:"changed"},id,true).problems.some(p=>p.includes('configuration')));
  const start=beginReceipt(cfg,{});git(root,'add','policy.js');const changed=finishReceipt(cfg,start,success);
  assert.ok(readReceipt(cfg,changed).problems.some(p=>p.includes('during execution')));
 }finally{await cleanup(root);}
});

test("receipts — failed, pending, empty and imported evidence is recorded but ineligible", async () => {
 const root=await project();try {
  const cfg=await loadConfig(root);
  for(const result of [{...success,exitCode:1},{...success,pending:1},{...success,onramp:true},{...success,observations:[]},{...success,observations:[{...success.observations[0],kind:"fail" as const}]}]) {
   const id=finishReceipt(cfg,beginReceipt(cfg,{}),result);assert.ok(readReceipt(cfg,id).problems.length);
  }
  const imported=finishReceipt(cfg,beginReceipt(cfg,{fromReport:"report.json"}),success);assert.ok(readReceipt(cfg,imported).problems.some(p=>p.includes('imported')));
 }finally{await cleanup(root);}
});

test("receipts — tampered, missing and noncanonical dependencies refuse instead of shrinking evidence", async () => {
 for(const target of ['receipt','start','seal','artifact']) {
  const root=await project();try {
   const cfg=await loadConfig(root), id=runReceipt(root), r=readReceipt(cfg,id);
   const path=join(root,r.files.find(p=>target==='receipt'?p.includes('/receipts/'):target==='artifact'?p.includes('/artifacts/'):target==='seal'?p.endsWith('.done.json'):p.includes('/starts/')&&!p.endsWith('.done.json'))!);
   const original=await readFile(path);await writeFile(path,original.subarray(0,original.length-1));assert.throws(()=>readReceipt(cfg,id),/torn|noncanonical/);
   await writeFile(path,original);assert.deepEqual(readReceipt(cfg,id).problems,[]);
   await rm(path);assert.throws(()=>readReceipt(cfg,id));
  }finally{await cleanup(root);}
 }
});

test("receipts — a killed verifier leaves an incomplete start and no inferred pass", async () => {
 const root=await project();try {
  await writeFile(join(root,'policy.test.js'),'import test from "node:test"; test("receipt executable control", async () => { await new Promise(r=>setTimeout(r,30000)); });\n');
  const child=spawn(process.execPath,[CLI,'verify','--receipt'],{cwd:root,env:childEnv(),stdio:['ignore','pipe','pipe'],detached:true});
  let output="";let signaled=false;const exited=once(child,'exit');
  child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('receipt started:')&&!signaled){signaled=true;process.kill(-child.pid!,'SIGKILL');}});
  const timeout=setTimeout(()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{}},10000);
  await exited;clearTimeout(timeout);assert.equal(signaled,true,output);
  const records=listReceipts(await loadConfig(root));assert.equal(records.incomplete.length,1);assert.equal(records.completed.length,0);
 }finally{await cleanup(root);}
});

test("receipts — publication refuses repeat terminals and surviving conflict objects", async () => {
 const root=await project();try {
  const cfg=await loadConfig(root), start=beginReceipt(cfg,{}), id=finishReceipt(cfg,start,success);
  assert.throws(()=>finishReceipt(cfg,start,{...success,exitCode:1}),/already has/);
  const receipt=readReceipt(cfg,id).receipt, conflict={...receipt,exitCode:1};
  await writeFile(join(root,'.coherence/verification/receipts',receiptHash(conflict)+'.json'),receiptCanonical(conflict)+'\n');
  assert.throws(()=>readReceipt(cfg,id),/competing terminal/);
 }finally{await cleanup(root);}
});

test("receipts — symlink redirection and malformed hashed shapes cannot become evidence", async () => {
 const root=await project(), outside=await tmpProject();try {
  const cfg=await loadConfig(root);await mkdir(join(root,'.coherence'),{recursive:true});await symlink(outside,join(root,'.coherence/verification'));
  assert.throws(()=>beginReceipt(cfg,{}),/redirected|non-regular/);await rm(join(root,'.coherence/verification'));
  const id=runReceipt(root), r=readReceipt(cfg,id);const path=r.files.find(p=>p.includes('/artifacts/'))!;
  await rm(join(root,path));await writeFile(join(outside,'fake'),'{}\n');await symlink(join(outside,'fake'),join(root,path));assert.throws(()=>readReceipt(cfg,id),/non-regular/);
 }finally{await cleanup(root);await cleanup(outside);}
});

test("receipts — concurrent finishers publish exactly one terminal without poisoning the winner", async () => {
 const root=await project();try {
  const cfg=await loadConfig(root),start=beginReceipt(cfg,{});
  const moduleURL=new URL('../src/evidence/receipts.ts',import.meta.url).href;
  const configURL=new URL('../src/config.ts',import.meta.url).href;
  const script=`import {finishReceipt} from ${JSON.stringify(moduleURL)}; import {loadConfig} from ${JSON.stringify(configURL)};
    const cfg=await loadConfig(process.argv[1]); process.send('ready'); process.once('message',()=>{
      try { const result=JSON.parse(process.argv[3]); console.log(finishReceipt(cfg,JSON.parse(process.argv[2]),result)); process.exit(0); }
      catch(e) { console.error(e.message);process.exit(2); }
    });`;
  const children=Array.from({length:4},(_,i)=>spawn(process.execPath,['--input-type=module','-e',script,root,JSON.stringify(start),JSON.stringify({...success,observations:[{...success.observations[0],node:`writer-${i}`} ]})],{env:childEnv(),stdio:['ignore','pipe','pipe','ipc']}));
  const exits=children.map(child=>once(child,'exit'));
  await Promise.all(children.map(child=>once(child,'message')));
  for(const child of children)child.send('go');
  const codes=(await Promise.all(exits)).map(([code])=>code);
  assert.equal(codes.filter(c=>c===0).length,1);assert.equal(codes.filter(c=>c===2).length,3);
  const records=listReceipts(cfg);assert.equal(records.completed.length,1);assert.equal(records.incomplete.length,0);
  assert.deepEqual(readReceipt(cfg,records.completed[0]).problems,[]);
 }finally{await cleanup(root);}
});

test("receipts — a correctly hashed malformed result and damaged publication target refuse", async () => {
 const root=await project();try {
  const cfg=await loadConfig(root),start=beginReceipt(cfg,{}),id=finishReceipt(cfg,start,success),r=readReceipt(cfg,id);
  const malformed={...r.receipt,observations:"all passed"},hash=receiptHash(malformed);
  await rm(join(root,r.files.find(p=>p.includes('/receipts/'))!));
  await writeFile(join(root,`.coherence/verification/receipts/${hash}.json`),receiptCanonical(malformed)+'\n');
  await writeFile(join(root,`.coherence/verification/starts/${start.run}.done.json`),receiptCanonical({version:1,run:start.run,receipt:hash})+'\n');
  assert.throws(()=>readReceipt(cfg,`sha256-${hash}`),/invalid terminal shape/);
  await rm(join(root,'.coherence/verification'),{recursive:true});
  await writeFile(join(root,'.coherence/verification'),'blocked');
  const result=cli(root,'verify','--receipt');assert.notEqual(result.code,0);assert.doesNotMatch(result.out,/receipt: verification:/);
 }finally{await cleanup(root);}
});

test("receipts — skipped and todo executable oracles cannot acquire execution credit", async () => {
 const root=await project();try {
  for(const modifier of ['skip','todo']) {
   await writeFile(join(root,'policy.test.js'),`import test from "node:test"; test.${modifier}("receipt executable control", () => { throw new Error("must not pass"); });\n`);
   const result=cli(root,'verify','--receipt');assert.equal(result.code,1,result.out+result.err);
   const id=result.out.match(/receipt: (verification:sha256-[a-f0-9]{64})/)?.[1];assert.ok(id,result.out);
   const receipt=readReceipt(await loadConfig(root),id);
   assert.ok(receipt.problems.length);assert.equal(receipt.receipt.observations[0].executed,false);
  }
 }finally{await cleanup(root);}
});

test("receipts — a failed named assertion remains executed evidence without becoming success", async () => {
 const root=await project();try {
  await writeFile(join(root,'policy.js'),'export const value = 0;\n');
  const result=cli(root,'verify','--receipt');assert.equal(result.code,1,result.out+result.err);
  const id=result.out.match(/receipt: (verification:sha256-[a-f0-9]{64})/)?.[1];assert.ok(id,result.out);
  const receipt=readReceipt(await loadConfig(root),id);
  assert.equal(receipt.receipt.observations[0].kind,'fail');assert.equal(receipt.receipt.observations[0].executed,true);
  assert.ok(receipt.problems.length);
 }finally{await cleanup(root);}
});

test("receipts — renamed surviving starts and unknown serial output remain unavailable", async () => {
 const root=await project();try {
  const cfg=await loadConfig(root),start=beginReceipt(cfg,{});
  const {rename}=await import('node:fs/promises');
  await rename(join(root,`.coherence/verification/starts/${start.run}.json`),join(root,`.coherence/verification/starts/.pending-${start.run}`));
  assert.throws(()=>listReceipts(cfg),/incomplete receipt publication/);
  const {runSerialNamedTest}=await import('../src/verification/phrasebook.ts');
  const fake={...cfg,test:[process.execPath,'-e','console.log("some successful output")','--'],testMatch:'successful'};
  assert.equal(runSerialNamedTest(fake,root,'oracle',true).ok,false);
 }finally{await cleanup(root);}
});

test("receipts — partially skipped structured batches do not borrow a passing sibling", async () => {
 const {resolveFromBatch}=await import('../src/verification/test-batch.ts');
 const report={format:'vitest-json' as const,tests:[{fullName:'cases alpha',status:'passed' as const},{fullName:'cases beta',status:'pending' as const}]};
 assert.equal(resolveFromBatch(report,'cases',true).ok,false);
 assert.equal(resolveFromBatch({...report,tests:[report.tests[0]]},'cases',true).ok,true);
});

test("receipts — prior batch files cannot impersonate a fresh successful runner", async () => {
 const root=await project();try {
  const config=JSON.parse(await readFile(join(root,'coherence.config.json'),'utf8'));
  config.test=[];config.testBatch=[process.execPath,'batch.js','--outputFile=report.json'];config.testBatchFormat='vitest-json';delete config.oracleExecution;
  await writeFile(join(root,'coherence.config.json'),JSON.stringify(config));
  const report={testResults:[{name:'policy.test.js',assertionResults:[{fullName:'receipt executable control',status:'passed'}]}]};
  await writeFile(join(root,'report.json'),JSON.stringify(report));
  for(const code of [0,1]) {
   await writeFile(join(root,'batch.js'),`process.exit(${code});\n`);
   const r=cli(root,'verify','--receipt');assert.equal(r.code,1,r.out+r.err);
   const id=r.out.match(/receipt: (verification:sha256-[a-f0-9]{64})/)?.[1];assert.ok(id,r.out);
   assert.ok(readReceipt(await loadConfig(root),id).problems.length);
  }
  // A newly written report at the supplied private destination remains a positive control.
  await writeFile(join(root,'batch.js'),`import {writeFileSync} from 'node:fs';const path=process.argv.find(x=>x.startsWith('--outputFile=')).slice('--outputFile='.length);writeFileSync(path,JSON.stringify(${JSON.stringify(report)}));\n`);
  const id=runReceipt(root);assert.deepEqual(readReceipt(await loadConfig(root),id,true).problems,[]);
  assert.equal(await readFile(join(root,'report.json'),'utf8'),JSON.stringify(report),'previous report is preserved');
 }finally{await cleanup(root);}
});


test("receipts — status publication scratch is excluded while similarly named source stays material", async () => {
 const root=await project();try {
  const cfg=await loadConfig(root),before=captureReceiptInputs(cfg);
  await mkdir(join(root,'.coherence'),{recursive:true});
  await writeFile(join(root,'.coherence/status-11111111-1111-4111-8111-111111111111.tmp'),'pending status');
  assert.deepEqual(captureReceiptInputs(cfg).manifest,before.manifest);
  await writeFile(join(root,'.coherence/status-policy.tmp'),'material authored bytes');
  assert.notDeepEqual(captureReceiptInputs(cfg).manifest,before.manifest);
 }finally{await cleanup(root);}
});
