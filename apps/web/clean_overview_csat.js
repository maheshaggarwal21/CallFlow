const fs = require('fs');
let f = 'app/dashboard/overview/page.tsx';
let c = fs.readFileSync(f, 'utf8');

c = c.replace(/import GaugeMeter from .*\r?\n/g, '');
c = c.replace(/const \[csatEmployeeId, setCsatEmployeeId\] = useState<string>\(.*?\"\);\r?\n/g, '');
c = c.replace(/const csat\s+=\s+data\?\.csat_score \?\? 0;\r?\n/g, '');
c = c.replace(/if \(csatEmployeeId\) p.set\(\"employee_id\", csatEmployeeId\);\r?\n/g, '');
c = c.replace(/, csatEmployeeId/g, '');
let csatBlock = c.indexOf('{/* Customer Satisfaction */}');
if(csatBlock !== -1) {
    let beforeCsat = c.substring(0, csatBlock);
    let rest = c.substring(csatBlock);
    
    // find the end of the div holding the csat section. 
    // it starts with <div style={{ background: C.card ... Customer satisfaction
    // we can search for Team Breakdown Grid
    let endBlock = rest.indexOf('{/* Team Breakdown Grid */}');
    if(endBlock !== -1) {
        c = beforeCsat + rest.substring(endBlock);
    }
}
fs.writeFileSync(f, c);
