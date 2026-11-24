import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {migrateLegacySetData,recipeLabor} from '../src/calc.js';

const folder=dirname(fileURLToPath(import.meta.url));

for(const browser of ['edge','desktop']){
  const source=JSON.parse(readFileSync(join(folder,`${browser}-2026-11-23.json`),'utf8'));
  const current=structuredClone(source);
  current.taxes ||= [];
  current.fabricTypes ||= [];
  if(current.settings?.tax!==undefined && !current.taxes.some(tax=>tax.id==='legacy-standard')){
    current.taxes.unshift({id:'legacy-standard',name:'Standart vergi',rate:String(current.settings.tax)});
  }
  if(current.settings)delete current.settings.tax;
  for(const set of current.sets||[]){
    if(!Array.isArray(set.taxIds))set.taxIds=set.includeTax===true?['legacy-standard']:[];
    set.profitRate ??= String(current.settings?.profit??'0');
    if(!Array.isArray(set.otherExpenses))set.otherExpenses=[];
  }
  migrateLegacySetData(current);

  const count=(data,key)=>data.recipes.reduce((total,recipe)=>total+(recipe[key]?.length||0),0);
  const rowCount=data=>data.sets.reduce((total,set)=>total+set.rows.length,0);
  if(current.recipes.length!==source.recipes.length || count(current,'operations')!==count(source,'operations') ||
     current.materials.length!==source.materials.length || current.sets.length!==source.sets.length ||
     rowCount(current)!==rowCount(source))throw Error(`${browser}: kayıt sayıları değişti`);
  for(const recipe of current.recipes){
    const original=source.recipes.find(item=>item.id===recipe.id);
    if(!original || JSON.stringify(recipe.operations)!==JSON.stringify(original.operations) ||
       JSON.stringify(recipeLabor(recipe))!==JSON.stringify(recipeLabor(original)))
      throw Error(`${browser}: işçilik verisi değişti`);
  }
  for(const set of current.sets){
    for(const row of set.rows){
      const recipe=current.recipes.find(item=>item.id===row.recipeId);
      if(!recipe)throw Error(`${browser}: yarı mamul bulunamadı`);
      if(!Array.isArray(row.materials))throw Error(`${browser}: set malzemesi taşınmadı`);
      const expected=(recipe.materials||[]).map(line=>({...line,size:recipe.size||'',fabric:recipe.fabric||''}));
      if(JSON.stringify(row.materials)!==JSON.stringify(expected))throw Error(`${browser}: malzeme tüketimi değişti`);
      for(const line of row.materials){
        if(!current.materials.some(item=>item.id===line.materialId))throw Error(`${browser}: malzeme bulunamadı`);
      }
    }
  }
  const destination=join(folder,`${browser}-labor-1.1.3.json`);
  writeFileSync(destination,JSON.stringify(current,null,2)+'\n','utf8');
  console.log(`${browser}: ${current.recipes.length} yarı mamul, ${count(current,'operations')} işlem, ${rowCount(current)} set satırı taşındı`);
}
