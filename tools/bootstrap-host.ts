import {mkdirSync,existsSync,writeFileSync,readFileSync,chmodSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';

// Run once as root on the explicitly authorized new ECS instance.
const base='/srv/tmy-phase2';
const config='/etc/tmy-phase2';
const ip=process.env.PHASE2_PUBLIC_IP;
if(!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error('Set PHASE2_PUBLIC_IP');
function run(program:string,args:string[]):string {return execFileSync(program,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function writeNew(path:string,value:string,mode=0o644):void {if(existsSync(path))throw new Error(`Refusing to overwrite ${path}`);writeFileSync(path,value,{mode});}
function user(name:string):void {try{run('id',[name]);}catch{run('useradd',['--system','--home-dir',`${base}/${name}`,'--shell','/sbin/nologin',name]);}}
if(existsSync(`${config}/bootstrap-complete`))throw new Error('Host already provisioned; use explicit upgrade deployment');
mkdirSync(config,{recursive:true,mode:0o750});
user('tmy-app');
run('chown',['root:tmy-app',config]);
for(const name of ['web','server','infra','updates/windows/stable'])mkdirSync(`${base}/${name}`,{recursive:true});
const dbPassword=randomBytes(30).toString('base64url');
run('chown',['-R','tmy-app:tmy-app',`${base}/server`]);
writeNew('/etc/my.cnf.d/tmy-phase2.cnf',`[mysqld]\nbind-address=127.0.0.1\nmysqlx-bind-address=127.0.0.1\ninnodb_buffer_pool_size=128M\nmax_connections=40\nperformance_schema=OFF\ndefault-time-zone='+08:00'\n`);
run('systemctl',['enable','--now','mysqld']);
// Fresh stock MySQL must accept local root administration; otherwise stop without bypassing auth.
run('mysql',['--protocol=socket','-uroot','-e',`CREATE DATABASE tmy_tri_manager CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER 'tmy_app'@'127.0.0.1' IDENTIFIED BY '${dbPassword}'; GRANT ALL PRIVILEGES ON tmy_tri_manager.* TO 'tmy_app'@'127.0.0.1';`]);
const jwt=randomBytes(48).toString('base64url');
writeNew(`${config}/server.env`,`NODE_ENV=production\nPORT=3000\nHOST=127.0.0.1\nDB_HOST=127.0.0.1\nDB_PORT=3306\nDB_USERNAME=tmy_app\nDB_USER=tmy_app\nDB_PASSWORD=${dbPassword}\nDB_DATABASE=tmy_tri_manager\nDB_NAME=tmy_tri_manager\nJWT_SECRET=${jwt}\nCORS_ORIGINS=https://${ip}\n`,0o640);
run('chown',['root:tmy-app',`${config}/server.env`]);
run('openssl',['req','-x509','-newkey','rsa:3072','-nodes','-days','90','-keyout',`${config}/tls.key`,'-out',`${config}/tls.crt`,'-subj',`/CN=${ip}`,'-addext',`subjectAltName=IP:${ip},IP:127.0.0.1,DNS:localhost`]);
chmodSync(`${config}/tls.key`,0o600);
writeNew('/etc/nginx/conf.d/tmy-phase2.conf',`server { listen 80; server_name ${ip}; return 301 https://$host$request_uri; }\nserver {\n listen 443 ssl; server_name ${ip};\n ssl_certificate ${config}/tls.crt; ssl_certificate_key ${config}/tls.key;\n ssl_protocols TLSv1.2 TLSv1.3;\n client_max_body_size 128m;\n add_header X-Content-Type-Options nosniff always;\n add_header Referrer-Policy same-origin always;\n location ^~ /git/ { return 410; }\n location /api/ { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto https; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_read_timeout 75s; }\n location /h5/ { alias ${base}/web/; try_files $uri $uri/ /h5/index.html; }\n location = /updates/windows/stable/latest.yml { alias ${base}/updates/windows/stable/latest.yml; default_type text/yaml; add_header Cache-Control \"no-store, no-cache, must-revalidate\" always; limit_except GET HEAD { deny all; } }\n location ^~ /updates/windows/stable/ { alias ${base}/updates/windows/stable/; autoindex off; default_type application/octet-stream; add_header Cache-Control \"public, max-age=31536000, immutable\" always; limit_except GET HEAD { deny all; } }\n location = / { return 302 /h5/; }\n}\n`);
try{run('setsebool',['-P','httpd_can_network_connect','1']);}catch{/* SELinux may be disabled. */}
try{run('semanage',['fcontext','-a','-t','httpd_sys_content_t',`${base}/web(/.*)?`]);run('semanage',['fcontext','-a','-t','httpd_sys_content_t',`${base}/updates(/.*)?`]);run('restorecon',['-Rv',`${base}/web`,`${base}/updates`]);}catch{/* Recheck static file access at deployment. */}
run('nginx',['-t']);
run('systemctl',['daemon-reload']);
run('systemctl',['enable','--now','nginx']);
const handoff={repository_url:'git@github.com:qq245168586/qqtSaaS.git',api_url:`https://${ip}/api`,database_user:'tmy_app',database_password:dbPassword,certificate:readFileSync(`${config}/tls.crt`,'utf8')};
writeNew(`${config}/handoff.json`,JSON.stringify(handoff,null,2),0o600);
writeNew(`${config}/bootstrap-complete`,new Date().toISOString(),0o600);
process.stdout.write('Configured GitHub source repository, loopback MySQL, TLS gateway and protected handoff file.\n');
