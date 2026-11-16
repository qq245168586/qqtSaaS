import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const ip='114.215.185.184';
const config='/etc/nginx/conf.d/tmy-phase2.conf';
const mode=process.argv[2];
function run(file:string,args:string[]):void{execFileSync(file,args,{stdio:'inherit'});}
function save(text:string):void{writeFileSync(config,text);run('nginx',['-t']);run('systemctl',['reload','nginx']);}
if(mode==='prepare'){
 const source=readFileSync(config,'utf8');
 if(!existsSync(`${config}.before-acme`))writeFileSync(`${config}.before-acme`,source);
 mkdirSync('/var/lib/tmy-acme/http/.well-known/acme-challenge',{recursive:true});
 const line=`server { listen 80; server_name ${ip}; return 301 https://$host$request_uri; }`;
 if(!source.includes(line))throw new Error('Unexpected gateway config; manual review required');
 const next=`server { listen 80; server_name ${ip}; location ^~ /.well-known/acme-challenge/ { root /var/lib/tmy-acme/http; default_type text/plain; } location / { return 301 https://$host$request_uri; } }`;
 try{run('semanage',['fcontext','-a','-t','httpd_sys_content_t','/var/lib/tmy-acme/http(/.*)?']);run('restorecon',['-R','/var/lib/tmy-acme/http']);}catch{/* Verify actual HTTP challenge before issuing. */}
 save(source.replace(line,next));
 writeFileSync('/var/lib/tmy-acme/http/.well-known/acme-challenge/phase2-probe','phase2-ip-certificate-probe');
}else if(mode==='activate'){
 const certificate='/etc/letsencrypt/live/tmy-phase2-ip';
 if(!existsSync(`${certificate}/fullchain.pem`))throw new Error('Certificate not issued');
 const source=readFileSync(config,'utf8');
 save(source.replace('/etc/tmy-phase2/tls.crt',`${certificate}/fullchain.pem`).replace('/etc/tmy-phase2/tls.key',`${certificate}/privkey.pem`));
 writeFileSync('/etc/systemd/system/tmy-certificate-renew.service',`[Unit]\nDescription=Renew TMY IP HTTPS certificate\n[Service]\nType=oneshot\nExecStart=/opt/tmy-certbot/bin/certbot renew --quiet --deploy-hook "/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx"\n`);
 writeFileSync('/etc/systemd/system/tmy-certificate-renew.timer',`[Unit]\nDescription=Check short-lived TMY IP certificate every 6 hours\n[Timer]\nOnCalendar=*-*-* 00,06,12,18:00:00\nRandomizedDelaySec=300\nPersistent=true\n[Install]\nWantedBy=timers.target\n`);
 run('systemctl',['daemon-reload']);run('systemctl',['enable','--now','tmy-certificate-renew.timer']);
}else throw new Error('Expected prepare or activate');
