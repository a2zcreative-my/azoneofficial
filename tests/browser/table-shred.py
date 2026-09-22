"""SHREDDING PROBE — v1.174.4, in the repo since v1.175.0.

A width sweep CANNOT see this: when text is broken inside its own column
nothing overflows, so the overflow probes correctly report zero. Run this one
after any change to wrapping, table or card CSS.

    pnpm build && node tests/browser/serve.mjs out 4177 &
    xvfb-run -a python3 tests/browser/table-shred.py

v1.174.4 - A table cell is shredded when the column is
narrower than the LONGEST WORD it holds: the browser then breaks inside the
word, which is how "Nur Nasuha binti Zainal Abidin" became one letter per
line on the CEO's phone. Intended multi-line content (a reason string, a
three-line NET stack) is NOT shredding - its words still fit.
env: TABS, WIDTH, PORT."""
import os, time
from selenium import webdriver
TABS=os.environ.get("TABS","Attendance,Payroll,Finance,Commission,Accounting,Staff,Users,Claims,Inventory,Sales,Hankei's,Leave").split(",")
W=int(os.environ.get("WIDTH","447")); PORT=os.environ.get("PORT","4177")
o=webdriver.WebKitGTKOptions(); o.binary_location="/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser"; o.add_argument("--automation")
d=webdriver.WebKitGTK(options=o); d.set_window_size(W,900)
d.get(f"http://127.0.0.1:{PORT}/portal")
d.execute_script("try{localStorage.setItem('azone-install-dismissed','1');localStorage.setItem('azone-lang','en');localStorage.setItem('azone-theme','light')}catch(e){}")
d.get(f"http://127.0.0.1:{PORT}/portal"); time.sleep(4)
MEASURE = r"""
 const ruler=document.createElement('span');
 ruler.style.cssText='position:absolute;visibility:hidden;white-space:nowrap;left:-9999px';
 document.body.appendChild(ruler);
 const out=[];
 for (const t of document.querySelectorAll('main table')) {
   for (const c of t.querySelectorAll('th, td')) {
     const txt=(c.textContent||'').trim(); if(!txt) continue;
     const r=c.getBoundingClientRect(); if(r.width===0) continue;
     const cs=getComputedStyle(c);
     /* v1.174.4 - a cell that may not wrap CANNOT shred: nowrap keeps the
        word whole by definition (it overflows its box instead, which the
        table's own scroller absorbs). Only a cell that is allowed to wrap
        can be broken mid-word, so only those are measured. */
     if (/nowrap|^pre$/.test(cs.whiteSpace)) continue;
     const inner=r.width - parseFloat(cs.paddingLeft||0) - parseFloat(cs.paddingRight||0);
     const longest=txt.split(/\s+/).reduce((a,b)=>a.length>=b.length?a:b,'');
     if (longest.length<3) continue;
     ruler.style.font=cs.font; ruler.style.letterSpacing=cs.letterSpacing;
     ruler.style.textTransform=cs.textTransform;
     ruler.style.fontVariantNumeric=cs.fontVariantNumeric;  /* tabular digits are wider */
     ruler.textContent=longest;
     const need=ruler.getBoundingClientRect().width;
     if (need > inner + 1) out.push({tag:c.tagName, colW:Math.round(inner), need:Math.round(need), word:longest.slice(0,24), wrap:cs.overflowWrap});
   }
 }
 ruler.remove();
 return out;"""
def go(tab):
    d.execute_script("[...document.querySelectorAll('button')].find((b)=>/^(More|Lagi)$/.test(b.textContent.trim())).click()"); time.sleep(0.8)
    return d.execute_script("const g=document.querySelector('[role=dialog]'); if(!g) return 0; const b=[...g.querySelectorAll('button')].find((x)=>x.textContent.trim()===arguments[0]); if(!b){const c=[...g.querySelectorAll('button')].find((x)=>/close|tutup/i.test(x.getAttribute('aria-label')||'')); if(c)c.click(); return 0;} b.click(); return 1;", tab)
bad=0
for tab in TABS:
    if not go(tab): print(f"skip {tab}"); continue
    time.sleep(1.8)
    hits=d.execute_script(MEASURE)
    if hits:
        bad+=1
        print(f"[{W}] {tab}: SHREDDED — {len(hits)} cell(s) narrower than their longest word")
        for h in hits[:3]: print(f"    <{h['tag'].lower()}> column {h['colW']}px needs {h['need']}px for \"{h['word']}\"  (overflow-wrap: {h['wrap']})")
    else:
        print(f"[{W}] {tab}: ok")
print(f"\n{bad} tab(s) with a shredded table column at {W}px")
d.quit()
