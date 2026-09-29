"""usage: transcripts.py <arm dir>  ->  JSON on stdout: per session, cost, turns, errors, hook output about gaps, scaffold control calls."""
import json,sys,re,os,glob
def sess(path):
    out={'lines':0,'result':None,'hooks':[],'scaffold_control':[],'gap_mentions':0,'gap_mention_samples':[],'bash':0,'tool_uses':0,'regulate_gap':False,'hook_texts':[]}
    if not os.path.exists(path): return out
    for line in open(path):
        line=line.strip()
        if not line: continue
        try: e=json.loads(line)
        except: continue
        out['lines']+=1
        t=e.get('type')
        if t=='system' and e.get('subtype')=='hook_response':
            o=e.get('output') or ''
            out['hooks'].append(e.get('hook_event'))
            txt=o+(e.get('stdout') or '')+(e.get('stderr') or '')
            m=re.search(r'Spec gaps[^\\\n]*',txt)
            if m: out['hook_texts'].append((e.get('hook_event'),m.group(0)[:400]))
        if t=='result':
            prev=out['result'] or {'duration_ms':0,'num_turns':0,'is_error':False,'results':0}
            out['result']={'subtype':e.get('subtype'),'terminal_reason':e.get('terminal_reason'),'total_cost_usd':e.get('total_cost_usd'),'duration_ms':prev['duration_ms']+(e.get('duration_ms') or 0),'num_turns':prev['num_turns']+(e.get('num_turns') or 0),'is_error':prev['is_error'] or bool(e.get('is_error')),'results':prev['results']+1}
        if t=='assistant':
            for c in e.get('message',{}).get('content',[]):
                if c.get('type')=='tool_use':
                    out['tool_uses']+=1
                    cmd=json.dumps(c.get('input',{}))
                    if 'scaffold control' in cmd or re.search(r'scaffold\\?"?\s+control',cmd): out['scaffold_control'].append(c['input'].get('command','')[:200])
                if c.get('type')=='text':
                    tx=c['text']
                    if re.search(r'spec gap|no traced control|control: none|\bgaps?\b',tx,re.I):
                        out['gap_mentions']+=1
                        if len(out['gap_mention_samples'])<4: out['gap_mention_samples'].append(tx[:500])
        if t=='user':
            # hook feedback injected in tool results / system reminders (regulate at Stop is a stop-hook block)
            s=json.dumps(e)
            if 'Spec gaps this session touched' in s: out['regulate_gap']=True
            for m in re.finditer(r'Spec gaps(?: \(as of[^)]*\))?: (?:\d+ entrances? carr|none new|not read yet)[^\\"]{0,300}',s):
                if len(out['hook_texts'])<8: out['hook_texts'].append(('user',m.group(0)))
    return out
arm=sys.argv[1]
res={}
for s in ('s1','s2'):
    res[s]=sess(os.path.join(arm,s+'.jsonl'))
    res[s]['err_bytes']=os.path.getsize(os.path.join(arm,s+'.err')) if os.path.exists(os.path.join(arm,s+'.err')) else None
print(json.dumps(res))
