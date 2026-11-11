import { readFileSync } from 'node:fs';
import { revisar } from './reglas.mjs';
const catalogo=JSON.parse(readFileSync(new URL('./catalogo.json',import.meta.url)));
const limpiar=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
const norm=s=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const slug=s=>norm(s).replaceAll(' ','-');
export function parsearAgenda(html){
 const agenda={...structuredClone(catalogo.agenda),paradas:[],tramos:[]};
 const encontrados={paradas:new Map(),tramos:new Map()};let dia;let activo=false;let anterior=-Infinity;let filas=0;let diaLocal;let horaLocal=-1;const extremos=new Set();
 for(const m of html.matchAll(/(\d{1,2}) de noviembre de 2026|<tr\b[^>]*>([\s\S]*?)<\/tr>/g)){
  if(m[1]){dia=Number(m[1]);continue;}
  const cells=[...m[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(c=>limpiar(c[1]));
  const fecha=cells[0]?.match(/(\d{1,2}) de noviembre de 2026/);if(fecha){dia=Number(fecha[1]);continue;}
  if(/^\d\d:\d\d$/.test(cells[0]??'')){if(diaLocal!==dia){horaLocal=-1;diaLocal=dia;}const local=Number(cells[0].replace(':',''));if(local<horaLocal)throw Error('horas de fuente fuera de orden');horaLocal=local;}
  if(!dia||dia<11||dia>17||!/^\d\d:\d\d$/.test(cells[0]??''))continue;
  const texto=cells[1];if(!texto)throw Error('fila incompleta');
  if(dia===11&&/Salida en avión.*Buenos Aires.*Lima/.test(texto))activo=true;
  if(!activo)continue;
  const entrada=catalogo.entradas.find(e=>e.dia===dia&&norm(e.texto)===norm(texto));
  const [h,min]=cells[0].split(':').map(Number);if(h>23||min>59)throw Error('hora inválida');
  let stamp=`2026-11-${String(dia).padStart(2,'0')}T${cells[0]}:00-05:00`;
  if(entrada?.ajuste_min){const d=new Date(Date.parse(stamp)+entrada.ajuste_min*60000-5*3600000);stamp=d.toISOString().slice(0,19)+'-05:00';}
  if(Date.parse(stamp)<anterior)throw Error('horas de fuente fuera de orden');anterior=Date.parse(stamp);filas++;
  if(entrada){for(const [grupo,id,campo] of entrada.targets){const p=encontrados[grupo].get(id)??{...catalogo.agenda[grupo].find(p=>p.id===id)};p[campo]=stamp;extremos.add(`${grupo}/${id}/${campo}`);encontrados[grupo].set(id,p);}}
  else {
   // New acts require both a known act kind and an explicit, known Peruvian venue.
   const venue=catalogo.entradas.find(e=>e.targets.some(t=>t[0]==='paradas')&&norm(texto).includes(norm(e.texto.split(/ en (?:la |el |las |los )?/i).at(-1)))&&/ en /i.test(e.texto));
   const tipo=/^SANTA MISA/i.test(texto)?'misa':/^ENCUENTRO/i.test(texto)?'encuentro':/^VISITA/i.test(texto)?'visita':/^CEREMONIA|^ORACIÓN|^VIGILIA/i.test(texto)?'ceremonia':null;
   if(!venue||!tipo)throw Error('acto o lugar no reconocido');
   const plantilla=catalogo.agenda.paradas.find(p=>p.id===venue.targets.find(t=>t[0]==='paradas')[1]);
   const p={...plantilla,id:`${slug(plantilla.ciudad)}-${tipo}-2026-11-${dia}-${slug(texto)}`,nombre:texto,tipo,inicio:stamp};encontrados.paradas.set(p.id,p);
  }
 }
 if(!activo||filas<16||!encontrados.paradas.size)throw Error('programa incompleto o irreconocible');
 for(const grupo of ['paradas','tramos'])agenda[grupo]=[...encontrados[grupo].values()];
 // Every flight endpoint must still be present; disappearance of flights needs review.
 for(const t of agenda.tramos){for(const campo of ['salida','llegada']){const e=catalogo.entradas.find(e=>e.targets.some(x=>x[0]==='tramos'&&x[1]===t.id&&x[2]===campo));if(!e||!extremos.has(`tramos/${t.id}/${campo}`))throw Error('extremo del tramo ausente');}}
 return agenda;
}
export function compararAgenda(actual,nueva){
 const descartado=revisar(nueva);if(descartado.length)return {agenda:structuredClone(actual),cambios:[],descartado};
 const agenda=structuredClone(actual),cambios=[];
 for(const grupo of ['paradas','tramos']){
  for(const n of nueva[grupo]){
   const p=agenda[grupo].find(p=>p.id===n.id);
   if(!p){agenda[grupo].push({...n,estado:'programada'});cambios.push({id:n.id,tipo:'nuevo'});continue;}
   for(const campo of grupo==='paradas'?['inicio']:['salida','llegada'])if(p[campo]!==n[campo]||p.estado==='ya_no_figura'){
    cambios.push({id:p.id,tipo:'reprogramada',campo,hora_anterior:p[campo],hora:n[campo]});p.hora_anterior=p[campo];p[campo]=n[campo];p.estado='reprogramada';
   }
  }
  for(const p of agenda[grupo])if(!nueva[grupo].some(n=>n.id===p.id)&&p.estado!=='ya_no_figura'){p.estado='ya_no_figura';cambios.push({id:p.id,tipo:'ya_no_figura'});}
 }
 if(cambios.length){agenda.paradas.sort((a,b)=>Date.parse(a.inicio)-Date.parse(b.inicio));agenda.tramos.sort((a,b)=>Date.parse(a.salida)-Date.parse(b.salida));}
 return {agenda,cambios,descartado:[]};
}
