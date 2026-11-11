import { createHash } from 'node:crypto';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parsearAgenda,compararAgenda } from './agenda.mjs';
import { leerAvion } from './avion.mjs';
import { leerClima as climaPredeterminado } from './clima.mjs';
import fuentes from './fuentes.json' with {type:'json'};
import vuelosPredeterminados from './vuelos.json' with {type:'json'};
const hash=s=>createHash('sha256').update(s).digest('hex');
export const peticion=(url)=>fetch(url,{headers:{'User-Agent':fuentes.user_agent},signal:AbortSignal.timeout(fuentes.timeout_ms)});
export async function vuelta({estado,now=new Date().toISOString(),pausa=false,fetcher=peticion,leerClima=climaPredeterminado,vuelos=vuelosPredeterminados}){
 let agenda=structuredClone(estado.agenda);if(!agenda)throw Error('Se requiere agenda inicial');
 let clima=structuredClone(estado.clima??{actualizado:null,fuente:'Open-Meteo',ciudades:{}});
 const fallos=structuredClone(estado.fallos??{}),vuelta={hora:now,fuentes:{},publicado:[],descartado:[],errores:[]};let alerta=false;let cambios=[];let avion=null;
 function rechazo(contenido,motivos){const fingerprint=hash(contenido);const prev=fallos.agenda.rechazados??[];if(!prev.includes(fingerprint)){alerta=true;fallos.agenda.rechazados=[...prev,fingerprint];}vuelta.descartado.push(...motivos);}
 function bien(f){fallos[f]={...fallos[f],fallos_seguidos:0,alertado:false,exito:now};vuelta.fuentes[f]={hora:now,estado:'ok'};}
 function mal(f,mensaje){const old=fallos[f]??{};const n=(old.fallos_seguidos??0)+1;fallos[f]={...old,fallos_seguidos:n,alertado:old.alertado||n>=3};if(n>=3&&!old.alertado)alerta=true;vuelta.errores.push(mensaje);vuelta.fuentes[f]={hora:old.exito??null,intento:now,estado:'error'};}
 if(!pausa){
  let contenido;
  try{
   const r=await fetcher(fuentes.agenda);if(!r.ok)throw Error('http');contenido=await r.text();
   const parsed=parsearAgenda(contenido);const result=compararAgenda(agenda,parsed);bien('agenda');
   if(result.descartado.length){rechazo(contenido,result.descartado);}
   else {agenda=result.agenda;cambios=result.cambios;agenda.actualizado=now;agenda.fuente={...agenda.fuente,url:fuentes.agenda};vuelta.publicado.push(...cambios);}
  }catch{
   const peruHora=new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(now));
   if(!contenido?.includes('ENCUENTRO')||!contenido.includes('noviembre de 2026'))mal('agenda',`no se pudo leer la agenda oficial a las ${peruHora}`);else bien('agenda');
   // Recognizable changed program that cannot be parsed is a rejected change, not a silent rewrite.
   if(contenido?.includes('ENCUENTRO')&&contenido.includes('noviembre de 2026')){rechazo(contenido,['programa modificado no supera revisión']);}
  }
  try{let consultado=false;avion=await leerAvion(agenda,vuelos,now,fetcher,()=>{consultado=true;});if(consultado)bien('avion');else vuelta.fuentes.avion={hora:null,estado:'sin_consulta'};}catch{mal('avion','no se pudo leer la posición del avión');}
  const ultimo=fallos.clima?.intento??clima.actualizado;
  if(!ultimo||Date.parse(now)-Date.parse(ultimo)>=3600000){
   try{const nuevo=await leerClima(agenda,now,fetcher);if(!nuevo?.actualizado||!nuevo.ciudades)throw Error('clima inválido');clima=nuevo;bien('clima');}catch{mal('clima','no se pudo leer el clima');}
   fallos.clima={...fallos.clima,intento:now};
  }else vuelta.fuentes.clima={hora:clima.actualizado,estado:'conservado'};
 }else for(const f of ['agenda','avion','clima'])vuelta.fuentes[f]={hora:f==='agenda'?agenda.actualizado??null:f==='clima'?clima.actualizado:null,estado:'pausa'};
 agenda.generado_en=now;agenda.fuente_observada_en=agenda.actualizado??null;clima.generado_en=now;clima.fuente_observada_en=clima.actualizado??null;
 const vivo={actualizado:now,generado_en:now,avion,detecciones:estado.vivo?.detecciones??[],agenda_cambios:pausa?estado.vivo?.agenda_cambios??[]:cambios,pausa,vuelta};
 return {agenda,clima,vivo,fallos,alerta};
}
async function json(path,fallback){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
export async function ejecutar(args=process.argv.slice(2)){
 const option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
 const estadoDir=resolve(option('--estado','estado')),site=resolve(option('--site','site'));
 const inicial=await json(`${site}/data/agenda.json`,null);
 const estado={agenda:await json(`${estadoDir}/agenda.json`,inicial),clima:await json(`${estadoDir}/clima.json`,await json(`${site}/data/clima.json`,undefined)),vivo:await json(`${estadoDir}/vivo.json`,{}),fallos:await json(`${estadoDir}/fallos.json`,{})};
 // The shared helper is reused only through an explicit exported API; legacy CLI helpers
 // can fetch at build time, so the parent must disable those calls in scheduled builds.
 let leerClima;
 try{if(process.env.VIGILANTE_PAUSA!=='1'&&(!estado.fallos.clima?.intento||Date.now()-Date.parse(estado.fallos.clima.intento)>=3600000)){const codigo=await readFile(resolve('scripts/clima.mjs'),'utf8');if(/export\s+(?:async\s+)?function\s+leerClima\b/.test(codigo)){const helper=await import(pathToFileURL(resolve('scripts/clima.mjs')));leerClima=helper.leerClima;}}}catch(e){if(e.code!=='ENOENT')throw e;}
 const result=await vuelta({estado,pausa:process.env.VIGILANTE_PAUSA==='1',...(leerClima?{leerClima}:{})});await mkdir(estadoDir,{recursive:true});
 for(const name of ['agenda','clima','vivo','fallos'])await writeFile(`${estadoDir}/${name}.json`,JSON.stringify(result[name],null,2)+'\n');
 await writeFile(`${estadoDir}/resultado.json`,JSON.stringify({alerta:result.alerta})+'\n');
 console.log(JSON.stringify({hora:result.vivo.actualizado,alerta:result.alerta,errores:result.vivo.vuelta.errores,descartado:result.vivo.vuelta.descartado}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)ejecutar().catch(()=>{console.error('No se pudo ejecutar el vigilante; revisar agenda inicial y estado JSON.');process.exitCode=1;});
