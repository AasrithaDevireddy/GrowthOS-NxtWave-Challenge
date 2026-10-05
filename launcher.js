const { spawn } = require('child_process');
const path = require('path');
const root = __dirname;
const services = [
  ['API', 4000, 'api/server.js'],
  ['ADMIN', 3000, 'admin/server.js'],
  ['STUDENT', 3001, 'student/server.js']
];
const children=[];
for (const [name, port, file] of services) {
  const child = spawn(process.execPath, [path.join(root,file)], {cwd:root, stdio:'inherit', windowsHide:false});
  children.push(child);
  child.on('error', err => console.error(`[${name}] failed: ${err.message}`));
  child.on('exit', code => console.log(`[${name}] exited (${code})`));
}
console.log('\nGrowthOS FINAL V6\nAdmin   http://localhost:3000\nStudent http://localhost:3001\nAPI     http://localhost:4000/api/health\n');
function shutdown(){for(const c of children) try{c.kill()}catch{} process.exit(0)}
process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);
