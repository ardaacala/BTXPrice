export const operationNames = [
  'Pastal açma / kesim','Ek pastal','Bantlama ve ek bantlama','Ek yapıştırma',
  'Panel açma ve panel yapıştırma','İnsizyon yapıştırma','Takviye açma ve takviye yapıştırma',
  'Kraton, poş ve cırt işlemleri','Delme, kesme ve etiketleme','Katlama',
  'Stokinet dikim','Lastik geçirme','Hazırlık, taşıma ve yükleme'
];

export function number(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
export const sum = values => values.reduce((a,b) => a+b,0);
export const round = (n, digits=6) => Math.round((n + Number.EPSILON) * 10**digits) / 10**digits;

export function laborRates(settings) {
  const salary=number(settings?.monthlySalary);
  const hours=number(settings?.monthlyHours);
  if (salary===null || salary<0 || hours===null || hours<=0) return null;
  const hour=salary/hours;
  return {hour,minute:hour/60,second:hour/3600};
}

export function materialPriceTL(material, settings) {
  const price=number(material?.price);
  if (price===null || price<0 || !['metre','adet','metrekare','kg'].includes(material?.unit)) return null;
  const usdBase=number(material?.usdBasePrice);
  if (usdBase!==null || material?.usdIndexPending) {
    const usdRate=number(settings?.usdTry);
    return usdBase!==null && usdBase>=0 && settings?.ratesVerified===true && usdRate!==null && usdRate>0
      ? usdBase*usdRate : null;
  }
  const currency=material.currency||'TRY';
  if (currency==='TRY') return price;
  if (settings?.ratesVerified !== true) return null;
  const rate=number(currency==='EUR'?settings?.eurTry:currency==='USD'?settings?.usdTry:null);
  return rate!==null && rate>0 ? price*rate : null;
}

export function durationMinutes(entry) {
  if (entry?.unit==='minuteSecond') {
    const match=String(entry.duration??'').trim().match(/^(\d+):([0-5]\d)$/);
    return match ? Number(match[1])+Number(match[2])/60 : null;
  }
  const duration=number(entry?.duration);
  return duration!==null&&duration>=0 ? duration*(entry?.unit==='hour'?60:1) : null;
}

// A duration is either elapsed minutes or already-normalized person-minutes.
export function personMinutes(entry) {
  if (!entry || entry.status === 'notApplicable') return {value:0,missing:false,applicable:false};
  if (entry.status === 'missing' || !entry.status) return {value:0,missing:true,applicable:true};
  if (entry.timeType !== 'elapsed') return {value:0,missing:true,applicable:true};
  const duration = durationMinutes(entry);
  const people = number(entry.people);
  const output = number(entry.output);
  if (duration === null || people === null || people <= 0)
    return {value:0,missing:true,applicable:true};
  if (entry.scope === 'batch' && (output === null || output <= 0)) return {value:0,missing:true,applicable:true};
  const total = duration * people;
  return {value:total / (entry.scope === 'batch' ? output : 1),missing:false,applicable:true};
}

export function recipeLabor(recipe) {
  const details = (recipe.operations || []).map(op=>personMinutes({...op,scope:recipe.method === 'production' ? 'batch':'unit'}));
  const detailTotal = sum(details.map(x=>x.value));
  const detailMissing = details.some(x=>x.missing);
  const reference = personMinutes({...recipe.readyTotal,scope:'unit'});
  const selected = recipe.method === 'ready' ? {value:0,missing:true} :
    {value:detailTotal,missing:detailMissing};
  const excluded = 0;
  return {value:round(selected.value),missing:selected.missing || recipe.method === 'ready',
    detailTotal:round(detailTotal),detailMissing,
    referenceTotal:recipe.readyTotal?.status === 'known' ? round(reference.value) : null,
    difference:recipe.readyTotal?.status === 'known' && !detailMissing ? round(detailTotal-reference.value) : null,
    excluded:round(excluded)};
}

export function placementLabor(placement, quantity) {
  if (!placement || placement.status === 'notApplicable') return {value:0,missing:false};
  const raw = personMinutes({...placement,scope:'unit'});
  if (raw.missing) return raw;
  const n = number(quantity);
  if (n === null || n <= 0) return {value:0,missing:true};
  if (placement.coverage === 'item') return {value:round(raw.value*n),missing:false};
  if (placement.coverage === 'row') return {value:round(raw.value),missing:false};
  const sets = number(placement.sets);
  return sets !== null && sets > 0 ? {value:round(raw.value/sets),missing:false} : {value:0,missing:true};
}

export function packageLabor(profile) {
  if (!profile) return {value:0,missing:false,parts:[]};
  const parts = [];
  const add = (label,entry,divisor=1) => {
    if (entry?.status === 'notApplicable') return;
    const v=personMinutes({...entry,scope:'unit'});
    parts.push({label,value:round(v.value/divisor),missing:v.missing});
  };
  add('Rulo geçirme',profile.rollInsert);
  add('Rulo kapama',profile.rollClose);
  const mode=profile.mode || 'none';
  if (mode === 'box' || mode === 'both') {
    const count=number(profile.setsPerBox);
    if(profile.boxLabor?.status !== 'notApplicable') {
      add('Koli işçiliği',profile.boxLabor,count && count>0 ? count : 1);
      if (count === null || count <= 0) {parts[parts.length-1].value=0;parts[parts.length-1].missing=true;}
    }
  }
  if (mode === 'bag' || mode === 'both') {
    const count=number(profile.setsPerBag);
    if(profile.bagLabor?.status !== 'notApplicable') {
      add('Torba işçiliği',profile.bagLabor,count && count>0 ? count : 1);
      if (count === null || count <= 0) {parts[parts.length-1].value=0;parts[parts.length-1].missing=true;}
    }
  }
  return {value:round(sum(parts.map(x=>x.value))),missing:parts.some(x=>x.missing),parts};
}

// Set satırındaki ilk doğrulanmış yarı mamul fiyatını daha sonra karşılaştırmak için.
export function recipeUnitCosts(recipe, state) {
  if (!recipe) return null;
  const labor=recipeLabor(recipe);
  if (labor.missing) return null;
  let material=0;
  for (const line of recipe.materials||[]) {
    const item=state.materials.find(x=>x.id===line.materialId);
    const quantity=number(line.quantity),price=materialPriceTL(item,state.settings);
    if (!item||quantity===null||quantity<0||price===null) return null;
    material+=quantity*price;
  }
  const minuteCost=laborRates(state.settings)?.minute;
  if (labor.value>0&&minuteCost===undefined) return null;
  const surcharge=number(state.settings.surcharge)??0;
  return {recipeId:recipe.id,material:round(material,4),labor:round(labor.value*(minuteCost??0)*(1+surcharge/100),4)};
}

export function recipePriceChange(snapshot, recipe, state) {
  if (!snapshot||snapshot.recipeId!==recipe?.id) return null;
  const current=recipeUnitCosts(recipe,state);
  if (!current) return null;
  const beforeMaterial=number(snapshot.material),beforeLabor=number(snapshot.labor);
  if (beforeMaterial===null||beforeLabor===null) return null;
  const materialDelta=round(current.material-beforeMaterial,4);
  const laborDelta=round(current.labor-beforeLabor,4);
  return {current,materialDelta,laborDelta,materialChanged:materialDelta!==0,laborChanged:laborDelta!==0};
}

function timeProblems(entry, {batch=false}={}) {
  if (!entry || entry.status === 'missing' || !entry.status) return ['ölçüm verisi eksik; doğrulanmış değer girin veya uygulanmıyor seçin'];
  if (entry.status === 'notApplicable') return [];
  const problems=[];
  if (entry.timeType!=='elapsed') problems.push('eski kişi-dakika yerine geçen süre ölçümü girin');
  if (durationMinutes(entry)===null) problems.push(entry.unit==='minuteSecond'?'geçen süreyi dk:sn biçiminde girin (ör. 2:35)':'geçerli geçen süre girin');
  if (entry.timeType==='elapsed' && !(number(entry.people)>0)) problems.push('çalışan kişi sayısını girin');
  if (batch && !(number(entry.output)>0)) problems.push('üretilen adedi girin');
  return problems;
}

export function calculateSet(set, state) {
  const minuteCost=laborRates(state.settings)?.minute ?? null;
  const rate=number(state.settings.surcharge) ?? 0;
  let materials=0,production=0,placement=0,missing=!(set.rows||[]).length,excluded=0;
  const issues=[];
  const issue=(message,tab='sets',recordId=set.id,path='')=>issues.push({message,tab,recordId,path});
  if (!(set.rows||[]).length) issue('Set içeriği: en az bir yarı mamul ekleyin.');
  const rows=(set.rows||[]).map((row,i)=>{
    const recipe=state.recipes.find(x=>x.id===row.recipeId);
    const qty=number(row.quantity);
    if (!recipe) issue(`Set satırı ${i+1}: yarı mamul seçin.`, 'sets',set.id,`rows.${i}.recipeId`);
    if (!(qty>0)) issue(`Set satırı ${i+1}: içerik adedini sıfırdan büyük girin.`, 'sets',set.id,`rows.${i}.quantity`);
    if (!recipe || !(qty>0)) {missing=true;return {row,missing:true};}
    const labor=recipeLabor(recipe);
    const placing=placementLabor(row.placement,qty);
    if (labor.missing) {
      if (recipe.method==='ready') issue(`${recipe.name}: eski hazır kişi-dakika girişi kullanılmıyor; üretim ölçümüne geçin.`,'recipes',recipe.id,'method');
      const selected=recipe.method==='ready'&&recipe.readySource==='total';
      const entries=selected?[recipe.readyTotal]:recipe.operations||[];
      entries.forEach((entry,j)=>timeProblems(entry,{batch:recipe.method==='production'&&!selected}).forEach(problem=>
        issue(`${recipe.name} · ${selected?'hazır toplam':entry.name||`işlem ${j+1}`}: ${problem}.`,'recipes',recipe.id,selected?'readyTotal.duration':`operations.${j}.duration`)));
    }
    if (placing.missing) {
      timeProblems(row.placement).forEach(problem=>issue(`Set satırı ${i+1} · sete dizme: ${problem}.`,'sets',set.id,`rows.${i}.placement.duration`));
      if (row.placement?.coverage==='sets' && !(number(row.placement.sets)>0)) issue(`Set satırı ${i+1} · sete dizme: ölçülen set sayısını girin.`,'sets',set.id,`rows.${i}.placement.sets`);
      if (!['item','row','sets'].includes(row.placement?.coverage)) issue(`Set satırı ${i+1} · sete dizme: ölçüm kapsamını seçin.`,'sets',set.id,`rows.${i}.placement.coverage`);
    }
    const material=sum((recipe.materials||[]).map((line,j)=>{
      const m=state.materials.find(x=>x.id===line.materialId);
      const amount=number(line.quantity), price=materialPriceTL(m,state.settings);
      if (!m) issue(`${recipe.name} · malzeme ${j+1}: malzeme seçin.`,'recipes',recipe.id,`materials.${j}.materialId`);
      if (amount===null || amount<0) issue(`${recipe.name} · malzeme ${j+1}: geçerli miktar girin.`,'recipes',recipe.id,`materials.${j}.quantity`);
      if (m && price===null) {
        const reason=number(m.price)===null||number(m.price)<0?'birim fiyatını girin':
          !['metre','adet','metrekare','kg'].includes(m.unit)?'geçerli malzeme birimi seçin':
          m.currency!=='TRY'?'TCMB döviz kuru alınamadı; kurları yenileyin':'birim fiyatını kontrol edin';
        issue(`${m.name}: ${reason}.`,m.currency!=='TRY'&&reason.startsWith('TCMB')?'settings':'materials',m.id,m.currency!=='TRY'&&reason.startsWith('TCMB')?'':'price');
      }
      if (!m || amount===null || amount<0 || price===null) {missing=true;return 0;}
      return amount*price;
    }))*qty;
    materials+=material; production+=labor.value*qty; placement+=placing.value;
    excluded+=labor.excluded*qty;
    if (labor.missing || placing.missing) missing=true;
    return {row,recipe,labor,placing,material,missing:labor.missing||placing.missing};
  });
  const profile=state.profiles.find(x=>x.id===set.profileId);
  if(set.profileId && !profile) {missing=true;issue('Set: seçili ambalaj profili bulunamadı; yeniden seçin.','sets',set.id,'profileId');}
  const packaging=packageLabor(profile);
  if (packaging.missing) {
    missing=true;
    const fields=[['rollInsert','Rulo geçirme'],['rollClose','Rulo kapama'],
      ...(['box','both'].includes(profile.mode)?[['boxLabor','Koli işçiliği']]:[]),
      ...(['bag','both'].includes(profile.mode)?[['bagLabor','Torba işçiliği']]:[])];
    for (const [field,label] of fields) timeProblems(profile[field]).forEach(problem=>issue(`${profile.name} · ${label}: ${problem}.`,'profiles',profile.id,`${field}.duration`));
    if (['box','both'].includes(profile.mode)&&profile.boxLabor?.status!=='notApplicable'&&!(number(profile.setsPerBox)>0)) issue(`${profile.name}: koli başına set sayısını girin.`,'profiles',profile.id,'setsPerBox');
    if (['bag','both'].includes(profile.mode)&&profile.bagLabor?.status!=='notApplicable'&&!(number(profile.setsPerBag)>0)) issue(`${profile.name}: torba başına set sayısını girin.`,'profiles',profile.id,'setsPerBag');
  }
  let preparation=packaging.value;
  const profileKinds=new Set(packaging.parts.map(x=>x.label));
  const extras=(set.extras||[]).map((x,i)=>{
    const duplicate=profileKinds.has(x.name);
    const v=personMinutes({...x,scope:'unit'});
    if (!duplicate) {preparation+=v.value;if(v.missing) {missing=true;timeProblems(x).forEach(problem=>issue(`Ek set işlemi ${i+1} · ${x.name}: ${problem}.`,'sets',set.id,`extras.${i}.duration`));}if(x.surchargeIncluded) excluded+=v.value;}
    return {item:x,value:v.value,missing:v.missing,duplicate};
  });
  const baseMinutes=production+placement+preparation;
  const baseLabor=baseMinutes===0 ? 0 : minuteCost===null ? null : round(baseMinutes*minuteCost,4);
  const eligibleMinutes=Math.max(0,baseMinutes-excluded);
  const supplement=eligibleMinutes===0 ? 0 : minuteCost===null ? null : round(eligibleMinutes*minuteCost*rate/100,4);
  const adjustedLabor=baseLabor===null ? null : round(baseLabor+supplement,4);
  const orderQuantity=number(set.orderQuantity??'1');
  const validOrder=Number.isInteger(orderQuantity)&&orderQuantity>0;
  const shippingInput=set.shippingTotal===''||set.shippingTotal===null||set.shippingTotal===undefined?0:number(set.shippingTotal);
  let shippingPerSet=0,expenseMissing=false;
  if(shippingInput===null||shippingInput<0){expenseMissing=true;shippingPerSet=null;issue('Set: toplam kargo giderini sıfır veya üzeri girin.','sets',set.id,'shippingTotal');}
  else if(shippingInput>0&&!validOrder){expenseMissing=true;shippingPerSet=null;issue('Kargo giderini set başına bölmek için sipariş adedini sıfırdan büyük tam sayı girin.','sets',set.id,'orderQuantity');}
  else shippingPerSet=validOrder?round(shippingInput/orderQuantity,4):0;
  const otherExpenseLines=(set.otherExpenses||[]).map((expense,i)=>{
    const amount=number(expense.amount),scope=expense.scope||'total';
    let perSet=null;
    if(amount===null||amount<0){expenseMissing=true;issue(`Diğer gider ${i+1}: tutarı sıfır veya üzeri girin.`,'sets',set.id,`otherExpenses.${i}.amount`);}
    else if(!['total','unit'].includes(scope)){expenseMissing=true;issue(`Diğer gider ${i+1}: hesap kapsamını seçin.`,'sets',set.id,`otherExpenses.${i}.scope`);}
    else if(scope==='total'&&amount>0&&!validOrder){expenseMissing=true;issue(`Diğer gider ${i+1}: toplam tutarı bölmek için sipariş adedini girin.`,'sets',set.id,'orderQuantity');}
    else perSet=scope==='unit'||!validOrder?amount:round(amount/orderQuantity,4);
    return {expense,amount,scope,perSet,missing:perSet===null};
  });
  const otherExpensePerSet=expenseMissing&&otherExpenseLines.some(x=>x.missing)?null:round(sum(otherExpenseLines.map(x=>x.perSet)),4);
  const baseTotal=adjustedLabor===null||shippingPerSet===null||otherExpensePerSet===null?null:round(materials+adjustedLabor+shippingPerSet+otherExpensePerSet,4);
  const profit=number(set.profitRate ?? state.settings.profit ?? '0');
  const invalidProfit=profit===null||profit<0;
  const taxes=Array.isArray(state.taxes) ? state.taxes : [];
  const selectedTaxIds=Array.isArray(set.taxIds) ? set.taxIds :
    (set.includeTax===true && taxes[0] ? [taxes[0].id] : []);
  const selectedTaxes=selectedTaxIds.map(id=>taxes.find(x=>x.id===id));
  const invalidTax=selectedTaxes.some(x=>!x || number(x.rate)===null || number(x.rate)<0);
  if (minuteCost===null && baseMinutes>0) {
    if (!(number(state.settings.monthlySalary)>=0)) issue('Ayarlar: aylık maaşı girin.','settings',null,'monthlySalary');
    if (!(number(state.settings.monthlyHours)>0)) issue('Ayarlar: aylık çalışma saatini sıfırdan büyük girin.','settings',null,'monthlyHours');
  }
  if (invalidProfit) issue('Set: hedef net kâr oranını sıfır veya üzeri girin.','sets',set.id,'profitRate');
  selectedTaxes.forEach((tax,i)=>{if(!tax)issue(`Set: seçili vergi ${i+1} bulunamadı; vergi seçimini düzeltin.`,'sets',set.id);else if(!(number(tax.rate)>=0))issue(`${tax.name}: vergi oranını sıfır veya üzeri girin.`,'settings',null);});
  const beforeTax=baseTotal===null||invalidProfit?null:round(baseTotal*(1+profit/100),4);
  const totalRate=sum(selectedTaxes.map(x=>number(x?.rate)||0));
  const taxLines=selectedTaxes.map(x=>({id:x?.id,name:x?.name||'Silinmiş vergi',rate:number(x?.rate),amount:beforeTax===null||invalidTax?null:round(beforeTax*number(x.rate)/100,4)}));
  const taxAmount=beforeTax===null || invalidTax?null:round(sum(taxLines.map(x=>x.amount)),4);
  const total=beforeTax===null||taxAmount===null?null:round(beforeTax+taxAmount,4);
  const costWithTax=baseTotal===null||taxAmount===null?null:round(baseTotal+taxAmount,4);
  const profitAmount=total===null||costWithTax===null?null:round(total-costWithTax,4);
  return {rows,extras,materials:round(materials,4),production:round(production),placement:round(placement),preparation:round(preparation),packaging,
    baseMinutes:round(baseMinutes),baseLabor,supplement,adjustedLabor,excluded:round(excluded),
    shippingTotal:shippingInput,shippingPerSet,otherExpenseLines,otherExpensePerSet,
    baseTotal,beforeTax,costWithTax,profitAmount,taxAmount,taxLines,taxRate:totalRate,total,profitRate:profit,
    issues,missing:missing||expenseMissing||(minuteCost===null&&baseMinutes>0)||invalidTax||invalidProfit,status:missing||expenseMissing||(minuteCost===null&&baseMinutes>0)||invalidTax||invalidProfit?'Eksik verili hesap':'Doğrulanmış hesap'};
}
