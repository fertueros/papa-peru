import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {parsearAgenda,compararAgenda} from '../agenda.mjs';
import {vuelta} from '../vuelta.mjs';
import {leerClima} from '../clima.mjs';
import {leerAvion} from '../avion.mjs';
const html=await readFile(new URL('./fixtures/programa-210926d.html',import.meta.url),'utf8');
const agenda=parsearAgenda(html),now='2026-11-15T18:30:00Z';
const response=body=>({ok:true,text:async()=>body});
test('parser detecta cambio real de Pucallpa y acto retirado del HTML',()=>{
 const nuevo=html.replace('<p>15:00</p>','<p>15:30</p>');
 assert.equal(parsearAgenda(nuevo).paradas.find(p=>p.id==='encuentro-amazonia-malecon').inicio,'2026-11-15T15:30:00-05:00');
 const quitado=html.replace(/<tr>(?:(?!<\/tr>)[\s\S])*?Visita privada a la Capilla San Óscar A\. Romero(?:(?!<\/tr>)[\s\S])*?<\/tr>/,'');
 assert.equal(parsearAgenda(quitado).paradas.length,23);
});
test('nuevo acto en lugar peruano conocido se normaliza; texto extraño exige revisión',()=>{
 const fila='<tr><td><p>12:00</p></td><td>VISITA A LOS VOLUNTARIOS en el “Malecón Puerto Callao”</td><td></td></tr>';
 const nuevo=html.replace('<tr><td width="50" valign="top"><p>13:05</p>',fila+'<tr><td width="50" valign="top"><p>13:05</p>');
 assert.equal(parsearAgenda(nuevo).paradas.length,25);
 assert.throws(()=>parsearAgenda(nuevo.replace('VISITA A LOS VOLUNTARIOS','INSTRUCCIONES DESCONOCIDAS')));
});
test('HTTP 403 y timeout mantienen datos, hora de último éxito y no filtran cuerpo',async()=>{
 for(const fetcher of [async()=>({ok:false,status:403,text:async()=>{throw Error('no leer');}}),async()=>{throw Error('Authorization: secret');}]){
 const r=await vuelta({estado:{agenda},now,fetcher,leerClima:async()=>({actualizado:now,ciudades:{}})});
 assert.deepEqual(r.agenda.paradas,agenda.paradas);assert.equal(r.alerta,false);assert.equal(r.fallos.agenda.fallos_seguidos,1);assert.ok(!JSON.stringify(r).includes('Authorization'));
 }
});
test('clima: una petición para todas las ciudades, contrato de portada y horas con offset',async()=>{
 let count=0;const c=await leerClima(agenda,now,async url=>{count++;const n=new URL(url).searchParams.get('latitude').split(',').length;return {ok:true,json:async()=>Array.from({length:n},()=>({current:{temperature_2m:25,weather_code:3,time:'2026-11-15T13:30'},hourly:{time:['2026-11-15T13:00'],precipitation_probability:[40]},daily:{time:['2026-11-15'],temperature_2m_max:[28],temperature_2m_min:[17],precipitation_probability_max:[70]}}))};});
 assert.equal(count,1);assert.equal(c.ciudades.lima.temp,25);assert.equal(c.ciudades.lima.lluvia_prob,40);assert.match(c.ciudades.lima.hora,/-05:00$/);assert.deepEqual(c.ciudades.lima.dias['2026-11-15'],{max:28,min:17,lluvia_prob:70});
});
test('hex confirmado, señal duplicada, futura y de antes de despegar',async()=>{
 const t=agenda.tramos.find(t=>t.id==='cusco-pucallpa'),ids={[t.id]:{hex:'abcdef'}};
 const p={hex:'abcdef',lat:-10,lon:-74,alt_baro:30000,seen_pos:1};
 const query=data=>async()=>({ok:true,json:async()=>data});
 assert.ok(await leerAvion(agenda,ids,now,query({now:Date.parse(now)/1000,aircraft:[p]})));
 assert.equal(await leerAvion(agenda,ids,now,query({now:Date.parse(now)/1000,aircraft:[p,p]})),null);
 assert.equal(await leerAvion(agenda,ids,now,query({now:Date.parse(now)/1000+60,aircraft:[p]})),null);
 const pre='2026-11-15T18:00:00Z';assert.equal(await leerAvion(agenda,ids,pre,query({now:Date.parse(pre)/1000,aircraft:[p]})),null);
});
test('CLI pausa persiste solo JSON y parte público en directorio temporal',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vigilante-'));await mkdir(join(root,'site/data'),{recursive:true});await writeFile(join(root,'site/data/agenda.json'),JSON.stringify(agenda));
 const r=spawnSync(process.execPath,['vigilante/vuelta.mjs','--estado',join(root,'estado'),'--site',join(root,'site')],{env:{...process.env,VIGILANTE_PAUSA:'1'},encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);const vivo=JSON.parse(await readFile(join(root,'estado/vivo.json')));assert.equal(vivo.pausa,true);assert.equal(vivo.avion,null);assert.ok(vivo.generado_en);assert.equal(JSON.parse(await readFile(join(root,'estado/resultado.json'))).alerta,false);
});
