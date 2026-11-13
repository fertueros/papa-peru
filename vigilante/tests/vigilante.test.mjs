import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parsearAgenda, compararAgenda } from '../agenda.mjs';
import { leerAvion } from '../avion.mjs';
import { vuelta } from '../vuelta.mjs';
const html = await readFile(new URL('./fixtures/programa-210926d.html', import.meta.url), 'utf8');
const base = JSON.parse(await readFile(new URL('./fixtures/agenda-oficial.json', import.meta.url)));
const now = '2026-11-15T18:30:00Z';
const ok = async () => ({ok:true,text:async()=>html});
test('programa real: 24 paradas, 8 tramos, ids y horas canónicos',()=>{
 const a=parsearAgenda(html); assert.equal(a.paradas.length,24); assert.equal(a.tramos.length,8);
 for(const key of ['paradas','tramos']) for(const p of base[key]) {const q=a[key].find(x=>x.id===p.id);assert.ok(q,p.id);for(const f of key==='paradas'?['inicio']:['salida','llegada'])assert.equal(q[f],p[f]);}
});
test('sin cambios conserva todos los metadatos, fotos e ids',()=>{const a=structuredClone(base);a.fotos={ejemplo:{autor:'Autor'}};assert.deepEqual(compararAgenda(a,parsearAgenda(html)).agenda,a);});
test('Pucallpa 15:30 → 15:00, desaparecido y reaparición',()=>{
 const a=structuredClone(base); a.paradas.find(p=>p.id==='encuentro-amazonia-malecon').inicio='2026-11-15T15:30:00-05:00';
 const r=compararAgenda(a,parsearAgenda(html));const p=r.agenda.paradas.find(p=>p.id==='encuentro-amazonia-malecon');assert.equal(p.estado,'reprogramada');assert.equal(p.hora_anterior,'2026-11-15T15:30:00-05:00');
 const b=parsearAgenda(html);b.paradas=b.paradas.filter(p=>p.id!=='visita-capilla-oscar-romero');
 const c=compararAgenda(base,b).agenda;assert.equal(c.paradas.find(p=>p.id==='visita-capilla-oscar-romero').estado,'ya_no_figura');assert.equal(compararAgenda(c,parsearAgenda(html)).agenda.paradas.find(p=>p.id==='visita-capilla-oscar-romero').estado,'reprogramada');
});
test('rechaza orden roto, lugar extranjero y acto desconocido sin alterar agenda',()=>{
 for(const mutate of [a=>a.paradas[1].inicio='2026-11-11T16:00:00-05:00',a=>a.paradas[1].ciudad='Roma',a=>a.paradas[1].tipo='invento']){const a=parsearAgenda(html);mutate(a);const r=compararAgenda(base,a);assert.deepEqual(r.agenda,base);assert.ok(r.descartado.length);}
});
test('acto nuevo reconocido se añade; HTML ilegible no se acepta',()=>{
 const a=parsearAgenda(html);a.paradas.push({...a.paradas.at(-1),id:'nueva-visita',tipo:'visita',inicio:'2026-11-16T13:30:00-05:00'});assert.equal(compararAgenda(base,a).agenda.paradas.length,25);
 assert.throws(()=>parsearAgenda('<html>error</html>'));
});
test('avión: identidad, ventana, tierra, frescura y ambigüedad',async()=>{
 const t=base.tramos.find(t=>t.id==='cusco-pucallpa');let calls=0;
 const plane={flight:'LPE123 ',hex:'abcdef',lat:-10,lon:-74,alt_baro:30000,seen_pos:5};
 const fetcher=async()=>{calls++;return {ok:true,json:async()=>({now:Date.parse(now)/1000,aircraft:[plane]})};};
 assert.equal(await leerAvion(base,{},now,fetcher),null);assert.equal(calls,0);
 const ids={[t.id]:{callsign:'LPE123',hex:null}};
 const p=await leerAvion(base,ids,now,fetcher);assert.equal(p.tramo,t.id);assert.equal(p.alt_m,9144);
 for(const patch of [{alt_baro:'ground'},{seen_pos:400},{flight:'OTHER'},{lat:null}]){const save={...plane};Object.assign(plane,patch);assert.equal(await leerAvion(base,ids,now,fetcher),null);Object.assign(plane,save);}
 assert.equal(await leerAvion(base,ids,'2026-11-15T21:00:00Z',fetcher),null);
});
test('fallos 403: conserva agenda, alerta solo al tercero y se rearma tras éxito',async()=>{
 let estado={agenda:base};const fail=async()=>{throw Error('secret token no debe salir');};
 for(let i=1;i<=5;i++){const r=await vuelta({estado,now,fetcher:fail,leerClima:async()=>({actualizado:now,ciudades:{}})});assert.equal(r.alerta,i===3);assert.deepEqual(r.agenda.paradas,base.paradas);assert.match(r.vivo.vuelta.errores[0],/no se pudo leer la agenda oficial/);assert.ok(!JSON.stringify(r).includes('secret token'));estado=r;}
 const recovered=await vuelta({estado,now,fetcher:ok});assert.equal(recovered.fallos.agenda.fallos_seguidos,0);
});
test('cambio rechazado alerta una vez por contenido, publica último bueno',async()=>{
 const broken=html.replace('18:15','16:00');let estado={agenda:base};for(let i=0;i<2;i++){const r=await vuelta({estado,now,fetcher:async()=>({ok:true,text:async()=>broken})});assert.equal(r.alerta,i===0);assert.deepEqual(r.agenda.paradas,base.paradas);estado=r;}
});
test('pausa no consulta ni publica posiciones; clima limitado a una hora incluso si falla',async()=>{
 let count=0;const clima=async()=>{count++;throw Error('fallo');};let estado={agenda:base};
 for(let i=0;i<3;i++){estado=await vuelta({estado,now:new Date(Date.parse(now)+i*300000).toISOString(),fetcher:ok,leerClima:clima});}assert.equal(count,1);
 const r=await vuelta({estado,now,pausa:true,fetcher:()=>{throw Error('no llamar');},leerClima:clima});assert.equal(r.vivo.pausa,true);assert.equal(r.vivo.avion,null);assert.equal(r.vivo.generado_en,now);assert.equal(r.clima.generado_en,now);
});
