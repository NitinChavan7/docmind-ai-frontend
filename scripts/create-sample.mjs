import { writeFileSync } from 'node:fs';
// A real, bundled PDF; no AI-generated answers or external document services.
const esc=s=>s.replace(/([\\()])/g,'\\$1');
const ink='0.16 0.21 0.17', muted='0.48 0.53 0.44', green='0.37 0.45 0.29';
const text=(x,y,size,s,font='F1',color=ink)=>`${color} rg BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${esc(s)}) Tj ET\n`;
const rect=(x,y,w,h,c)=>`${c} rg ${x} ${y} ${w} ${h} re f\n`;
const line=(x,y,x2,y2)=>`0.85 0.87 0.81 RG 0.6 w ${x} ${y} m ${x2} ${y2} l S\n`;
let cover=rect(0,0,612,792,'0.996 0.992 0.976');
cover+=text(52,738,10,'FIELDNOTES', 'F2',green)+text(434,738,8,'THE WORK SERIES  /  001','F1',muted)+line(52,719,560,719);
cover+=text(52,679,8,'A PRACTICAL GUIDE TO THINKING CLEARLY','F2',green);
cover+=text(49,623,43,'The art of','F3')+text(49,575,43,'focused work.','F4',green);
cover+=text(52,539,12,'Finding clarity in a world that never stops talking.','F1',muted);
cover+=text(52,495,8,'RESEARCH & PRACTICE', 'F2',green)+text(401,495,8,'8 MIN READ  /  FIELD GUIDE','F1',muted);
cover+=line(52,476,560,476);
cover+=text(52,440,18,'01   A case for doing less, better','F3');
const lines=['We have more information at our fingertips than ever before. Yet the','space to make sense of it feels increasingly rare. Focus is not simply','about getting more done. It is about giving meaningful work the','attention it deserves.'];
lines.forEach((s,i)=>cover+=text(52,413-i*18,11,s,'F1',muted));
cover+=rect(52,239,508,78,'0.94 0.95 0.90')+rect(52,239,3,78,'0.53 0.63 0.41');
cover+=text(70,288,16,'Attention is a choice. Make it deliberately.','F4',green);
cover+=text(70,265,10,'A small shift in how we work can create space for deeper thinking.','F1',muted);
cover+=text(52,204,17,'Three principles to start with','F3');
[['01','Create space','Protect time for one meaningful task.'],['02','Reduce the noise','Keep only what helps you move forward.'],['03','Follow your curiosity','Ask better questions of what you read.']].forEach(([n,a,b],i)=>{const y=170-i*34;cover+=text(52,y,9,n,'F2',green)+text(80,y,10,a,'F2')+text(80,y-14,9,b,'F1',muted)});
cover+=line(52,61,560,61)+text(52,41,7,'DOCMIND LIBRARY  /  SAMPLE DOCUMENT','F1',muted)+text(498,41,7,'01  /  03','F1',muted);
function pageTwo(num,title,subtitle,sections){
 let s=rect(0,0,612,792,'0.996 0.992 0.976')+text(52,738,10,'FIELDNOTES','F2',green)+text(442,738,8,'THE FOCUSED WORK GUIDE','F1',muted)+line(52,719,560,719);
 s+=text(52,668,8,'THE WORK SERIES','F2',green)+text(52,619,32,title,'F3')+text(52,588,12,subtitle,'F1',muted);
 let y=528;
 sections.forEach(([heading,body])=>{s+=text(52,y,19,heading,'F3');body.forEach((t,i)=>s+=text(52,y-30-i*19,11,t,'F1',muted));y-=145});
 return s+line(52,61,560,61)+text(52,41,7,'DOCMIND LIBRARY  /  SAMPLE DOCUMENT','F1',muted)+text(498,41,7,`0${num}  /  03`,'F1',muted);
}
const streams=[cover,pageTwo(2,'Make room for depth.','A simple practice for a more intentional day.',[
 ['02   Start with a clear intention',['Before opening another tab, write down one thing you want to learn.','A precise question turns passive reading into an active conversation.','Keep that question beside you as you explore a document.']],
 ['03   Build a small ritual',['Choose a time and a place where you can work without interruption.','Silence notifications. Close unrelated tabs. Give yourself twenty-five','minutes to stay with a single idea before taking a short break.']],
 ['04   Leave a trail of thought',['Capture what surprises you. Write a short summary in your own words.','Note the page number so you can return to the original source.','Understanding grows when ideas have somewhere to land.']]
]),pageTwo(3,'From reading to insight.','A few questions worth taking with you.',[
 ['05   Look beyond the summary',['What is the central claim? What evidence supports it?','Which assumptions remain untested? Where does the argument change?','A useful summary opens a door. Close reading takes you through it.']],
 ['06   Connect the dots',['Relate a new idea to something you already know. Look for patterns','across sections, and pay attention to contradictions. An unexpected','connection can be more valuable than a long list of facts.']],
 ['07   Put one idea into practice',['Choose a single insight and turn it into a small, concrete action.','Return to it after a week. What changed? What would you adjust?','Clarity becomes useful when it changes the way you work.']]
])];
const objects=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>','<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>','<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >>'];
const kids=[];
for(const stream of streams){const id=objects.length+1;kids.push(`${id} 0 R`);objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ${id+1} 0 R >>`);objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`)}
objects[1]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count 3 >>`;
let pdf='%PDF-1.4\n';const offsets=[0];
objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`});
const start=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
pdf+=offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('');
pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
writeFileSync(new URL('../public/sample-research.pdf',import.meta.url),pdf);
