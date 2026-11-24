const operationNames = [
  'Pastal açma / kesim','Ek pastal','Bantlama ve ek bantlama','Ek yapıştırma',
  'Panel açma ve panel yapıştırma','İnsizyon yapıştırma','Takviye açma ve takviye yapıştırma',
  'Kraton, poş ve cırt işlemleri','Delme, kesme ve etiketleme','Katlama',
  'Stokinet dikim','Lastik geçirme','Hazırlık, taşıma ve yükleme'
];

function number(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
const sum = values => values.reduce((a,b) => a+b,0);
const round = (n, digits=6) => Math.round((n + Number.EPSILON) * 10**digits) / 10**digits;

function migrateLegacySetData(data) {
  for(const set of data.sets||[]){
    if(set.shippingBoxSize===undefined||set.shippingBoxPrice===undefined){
      if(set.shippingTotal!==undefined&&set.shippingTotal!==null&&set.shippingTotal!=='')set.legacyShippingTotal=String(set.shippingTotal);
      set.shippingBoxSize ??= '';set.shippingBoxPrice ??= '';
    }
    delete set.shippingTotal;
    for(const row of set.rows||[]){
      if(Array.isArray(row.materials))continue;
      const recipe=data.recipes?.find(x=>x.id===row.recipeId);
      row.materials=(recipe?.materials||[]).map(line=>({...line,size:recipe.size||'',fabric:recipe.fabric||''}));
    }
  }
  return data;
}

function laborRates(settings) {
  const salary=number(settings?.monthlySalary);
  const hours=number(settings?.monthlyHours);
  if (salary===null || salary<0 || hours===null || hours<=0) return null;
  const hour=salary/hours;
  return {hour,minute:hour/60,second:hour/3600};
}

function materialPriceTL(material, settings) {
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

function durationMinutes(entry) {
  if (entry?.unit==='minuteSecond') {
    const match=String(entry.duration??'').trim().match(/^(\d+):([0-5]\d)$/);
    return match ? Number(match[1])+Number(match[2])/60 : null;
  }
  const duration=number(entry?.duration);
  return duration!==null&&duration>=0 ? duration*(entry?.unit==='hour'?60:1) : null;
}
const hasDuration = entry => entry?.duration !== '' && entry?.duration !== null && entry?.duration !== undefined;

// A duration is either elapsed minutes or already-normalized person-minutes.
function personMinutes(entry) {
  if (!hasDuration(entry)) return {value:0,missing:false,applicable:false};
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

function recipeLabor(recipe) {
  const details = (recipe.operations || []).map(op=>personMinutes({...op,scope:recipe.method === 'production' ? 'batch':'unit'}));
  const detailTotal = sum(details.map(x=>x.value));
  const detailMissing = details.some(x=>x.missing);
  const reference = personMinutes({...recipe.readyTotal,scope:'unit'});
  const selected = recipe.method === 'ready' ? {value:0,missing:true} :
    {value:detailTotal,missing:detailMissing};
  const excluded = 0;
  return {value:round(selected.value),missing:selected.missing || recipe.method === 'ready',
    detailTotal:round(detailTotal),detailMissing,
    referenceTotal:hasDuration(recipe.readyTotal) && !reference.missing ? round(reference.value) : null,
    difference:hasDuration(recipe.readyTotal) && !reference.missing && !detailMissing ? round(detailTotal-reference.value) : null,
    excluded:round(excluded)};
}

function placementLabor(placement, quantity) {
  if (!hasDuration(placement)) return {value:0,missing:false,applicable:false};
  const raw = personMinutes({...placement,scope:'unit'});
  if (raw.missing) return raw;
  const n = number(quantity);
  if (n === null || n <= 0) return {value:0,missing:true};
  if (placement.coverage === 'item') return {value:round(raw.value*n),missing:false};
  if (placement.coverage === 'row') return {value:round(raw.value),missing:false};
  const sets = number(placement.sets);
  return sets !== null && sets > 0 ? {value:round(raw.value/sets),missing:false} : {value:0,missing:true};
}

function packageLabor(profile) {
  if (!profile) return {value:0,missing:false,parts:[]};
  const parts = [];
  const add = (label,entry,divisor=1) => {
    if (!hasDuration(entry)) return;
    const v=personMinutes({...entry,scope:'unit'});
    parts.push({label,value:round(v.value/divisor),missing:v.missing});
  };
  add('Rulo geçirme',profile.rollInsert);
  add('Rulo kapama',profile.rollClose);
  const mode=profile.mode || 'none';
  if (mode === 'box' || mode === 'both') {
    const count=number(profile.setsPerBox);
    if(hasDuration(profile.boxLabor)) {
      add('Koli işçiliği',profile.boxLabor,count && count>0 ? count : 1);
      if (count === null || count <= 0) {parts[parts.length-1].value=0;parts[parts.length-1].missing=true;}
    }
  }
  if (mode === 'bag' || mode === 'both') {
    const count=number(profile.setsPerBag);
    if(hasDuration(profile.bagLabor)) {
      add('Torba işçiliği',profile.bagLabor,count && count>0 ? count : 1);
      if (count === null || count <= 0) {parts[parts.length-1].value=0;parts[parts.length-1].missing=true;}
    }
  }
  return {value:round(sum(parts.map(x=>x.value))),missing:parts.some(x=>x.missing),parts};
}

// Set satırındaki ilk doğrulanmış yarı mamul fiyatını daha sonra karşılaştırmak için.
function setRowUnitCosts(row, state) {
  const recipe=state.recipes.find(x=>x.id===row?.recipeId);
  if (!recipe) return null;
  const labor=recipeLabor(recipe);
  if (labor.missing) return null;
  let material=0;
  for (const line of row.materials||[]) {
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

function setRowPriceChange(snapshot, row, state) {
  if (!snapshot||snapshot.recipeId!==row?.recipeId) return null;
  const current=setRowUnitCosts(row,state);
  if (!current) return null;
  const beforeMaterial=number(snapshot.material),beforeLabor=number(snapshot.labor);
  if (beforeMaterial===null||beforeLabor===null) return null;
  const materialDelta=round(current.material-beforeMaterial,4);
  const laborDelta=round(current.labor-beforeLabor,4);
  return {current,materialDelta,laborDelta,materialChanged:materialDelta!==0,laborChanged:laborDelta!==0};
}

function timeProblems(entry, {batch=false}={}) {
  if (!hasDuration(entry)) return [];
  const problems=[];
  if (entry.timeType!=='elapsed') problems.push('eski kişi-dakika yerine geçen süre ölçümü girin');
  if (durationMinutes(entry)===null) problems.push(entry.unit==='minuteSecond'?'geçen süreyi dk:sn biçiminde girin (ör. 2:35)':'geçerli geçen süre girin');
  if (entry.timeType==='elapsed' && !(number(entry.people)>0)) problems.push('çalışan kişi sayısını girin');
  if (batch && !(number(entry.output)>0)) problems.push('üretilen adedi girin');
  return problems;
}

function calculateSet(set, state) {
  const minuteCost=laborRates(state.settings)?.minute ?? null;
  const rate=number(state.settings.surcharge) ?? 0;
  let materials=0,production=0,placement=0,missing=!(set.rows||[]).length,excluded=0;
  const issues=[];
  const warnings=[];
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
    if(recipe.method==='production' && !(recipe.operations||[]).some(hasDuration)) warnings.push(`${recipe.name}: üretim süresi girilmedi; üretim işçiliği uygulanmadı.`);
    else if(recipe.method==='production') (recipe.operations||[]).forEach((entry,j)=>{
      if(!hasDuration(entry))warnings.push(`${recipe.name} · ${entry.name||`işlem ${j+1}`}: süre girilmedi; işlem hesaba katılmadı.`);
    });
    if(!hasDuration(row.placement)) warnings.push(`${recipe.name}: sete dizme süresi girilmedi; dizme işçiliği uygulanmadı.`);
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
    let rowMaterialMissing=false;
    const material=sum((row.materials||[]).map((line,j)=>{
      const m=state.materials.find(x=>x.id===line.materialId);
      const amount=number(line.quantity), price=materialPriceTL(m,state.settings);
      if (!m) issue(`${recipe.name} · malzeme ${j+1}: malzeme seçin.`,'sets',set.id,`rows.${i}.materials.${j}.materialId`);
      if (amount===null || amount<0) issue(`${recipe.name} · malzeme ${j+1}: geçerli miktar girin.`,'sets',set.id,`rows.${i}.materials.${j}.quantity`);
      if (m && price===null) {
        const reason=number(m.price)===null||number(m.price)<0?'birim fiyatını girin':
          !['metre','adet','metrekare','kg'].includes(m.unit)?'geçerli malzeme birimi seçin':
          m.currency!=='TRY'?'TCMB döviz kuru alınamadı; kurları yenileyin':'birim fiyatını kontrol edin';
        issue(`${m.name}: ${reason}.`,m.currency!=='TRY'&&reason.startsWith('TCMB')?'settings':'materials',m.id,m.currency!=='TRY'&&reason.startsWith('TCMB')?'':'price');
      }
      if (!m || amount===null || amount<0 || price===null) {missing=true;rowMaterialMissing=true;return 0;}
      return amount*price;
    }))*qty;
    materials+=material; production+=labor.value*qty; placement+=placing.value;
    excluded+=labor.excluded*qty;
    if (labor.missing || placing.missing) missing=true;
    return {row,recipe,labor,placing,material,missing:labor.missing||placing.missing||rowMaterialMissing};
  });
  const profile=state.profiles.find(x=>x.id===set.profileId);
  if(set.profileId && !profile) {missing=true;issue('Set: seçili ambalaj profili bulunamadı; yeniden seçin.','sets',set.id,'profileId');}
  const packaging=packageLabor(profile);
  if(profile){
    for(const [field,label] of [['rollInsert','Rulo geçirme'],['rollClose','Rulo kapama'],...(['box','both'].includes(profile.mode)?[['boxLabor','Koli işçiliği']]:[]),...(['bag','both'].includes(profile.mode)?[['bagLabor','Torba işçiliği']]:[])]){
      if(!hasDuration(profile[field]))warnings.push(`${profile.name} · ${label}: süre girilmedi; işçilik hesaba katılmadı.`);
    }
  }
  if (packaging.missing) {
    missing=true;
    const fields=[['rollInsert','Rulo geçirme'],['rollClose','Rulo kapama'],
      ...(['box','both'].includes(profile.mode)?[['boxLabor','Koli işçiliği']]:[]),
      ...(['bag','both'].includes(profile.mode)?[['bagLabor','Torba işçiliği']]:[])];
    for (const [field,label] of fields) timeProblems(profile[field]).forEach(problem=>issue(`${profile.name} · ${label}: ${problem}.`,'profiles',profile.id,`${field}.duration`));
    if (['box','both'].includes(profile.mode)&&hasDuration(profile.boxLabor)&&!(number(profile.setsPerBox)>0)) issue(`${profile.name}: koli başına set sayısını girin.`,'profiles',profile.id,'setsPerBox');
    if (['bag','both'].includes(profile.mode)&&hasDuration(profile.bagLabor)&&!(number(profile.setsPerBag)>0)) issue(`${profile.name}: torba başına set sayısını girin.`,'profiles',profile.id,'setsPerBag');
  }
  let preparation=packaging.value;
  const profileKinds=new Set(packaging.parts.map(x=>x.label));
  const extras=(set.extras||[]).map((x,i)=>{
    const duplicate=profileKinds.has(x.name);
    const v=personMinutes({...x,scope:'unit'});
    if(!duplicate && !hasDuration(x))warnings.push(`Ek set işlemi ${i+1} · ${x.name}: süre girilmedi; işçilik hesaba katılmadı.`);
    if (!duplicate) {preparation+=v.value;if(v.missing) {missing=true;timeProblems(x).forEach(problem=>issue(`Ek set işlemi ${i+1} · ${x.name}: ${problem}.`,'sets',set.id,`extras.${i}.duration`));}if(x.surchargeIncluded) excluded+=v.value;}
    return {item:x,value:v.value,missing:v.missing,duplicate};
  });
  const baseMinutes=production+placement+preparation;
  const baseLabor=baseMinutes===0 ? 0 : minuteCost===null ? null : round(baseMinutes*minuteCost,4);
  const eligibleMinutes=Math.max(0,baseMinutes-excluded);
  const supplement=eligibleMinutes===0 ? 0 : minuteCost===null ? null : round(eligibleMinutes*minuteCost*rate/100,4);
  const adjustedLabor=baseLabor===null ? null : round(baseLabor+supplement,4);
  const administrativeLabor=adjustedLabor;
  const totalLabor=adjustedLabor===null ? null : round(adjustedLabor+administrativeLabor,4);
  const orderQuantity=number(set.orderQuantity??'1');
  const validOrder=Number.isInteger(orderQuantity)&&orderQuantity>0;
  const hasBoxSize=set.shippingBoxSize!==''&&set.shippingBoxSize!==null&&set.shippingBoxSize!==undefined;
  const hasBoxPrice=set.shippingBoxPrice!==''&&set.shippingBoxPrice!==null&&set.shippingBoxPrice!==undefined;
  const boxCountInput=hasBoxSize?number(set.shippingBoxSize):null;
  const boxPriceInput=hasBoxPrice?number(set.shippingBoxPrice):null;
  let shippingPerSet=0,shippingTotal=0,shippingBoxCount=0,expenseMissing=false;
  if(!hasBoxSize&&!hasBoxPrice) {
    if(set.legacyShippingTotal!==undefined&&set.legacyShippingTotal!==''&&number(set.legacyShippingTotal)!==0){
      expenseMissing=true;shippingPerSet=null;shippingTotal=null;shippingBoxCount=null;
      issue(`Kargo: eski toplam kargo kaydı (${set.legacyShippingTotal} TL) için koli içi adet ve bir koli maliyetini girin.`,'sets',set.id,'shippingBoxSize');
    }
  }
  else if(!Number.isInteger(boxCountInput)||boxCountInput<=0){expenseMissing=true;shippingPerSet=null;shippingTotal=null;shippingBoxCount=null;issue('Kargo: koli içi adedi sıfırdan büyük tam sayı girin.','sets',set.id,'shippingBoxSize');}
  else if(!validOrder){expenseMissing=true;shippingPerSet=null;shippingTotal=null;shippingBoxCount=null;issue('Kargo: koli sayısını hesaplamak için sipariş adedini sıfırdan büyük tam sayı girin.','sets',set.id,'orderQuantity');}
  else {
    shippingBoxCount=Math.ceil(orderQuantity/boxCountInput);
    if(!hasBoxPrice)warnings.push('Kargo: koli maliyeti girilmedi; kargo gideri uygulanmadı. Koli içi adet sterilizasyon için kullanılabilir.');
    else if(boxPriceInput===null||boxPriceInput<0){expenseMissing=true;shippingPerSet=null;shippingTotal=null;issue('Kargo: bir koli kargo maliyetini sıfır veya üzeri girin.','sets',set.id,'shippingBoxPrice');}
    else {shippingTotal=round(shippingBoxCount*boxPriceInput,4);shippingPerSet=round(shippingTotal/orderQuantity,4);}
  }
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
  const hasSterilization=set.sterilizationPerBox!==''&&set.sterilizationPerBox!==null&&set.sterilizationPerBox!==undefined;
  const sterilizationRate=hasSterilization?number(set.sterilizationPerBox):null;
  let sterilizationTotal=0,sterilizationPerSet=0;
  if(hasSterilization){
    if(sterilizationRate===null||sterilizationRate<0){expenseMissing=true;sterilizationTotal=null;sterilizationPerSet=null;issue('Sterilizasyon: koli başına maliyeti sıfır veya üzeri girin.','sets',set.id,'sterilizationPerBox');}
    else if(!Number.isInteger(boxCountInput)||boxCountInput<=0||!validOrder){expenseMissing=true;sterilizationTotal=null;sterilizationPerSet=null;issue('Sterilizasyon: koli içi adet ve geçerli sipariş adedi girin.','sets',set.id,'shippingBoxSize');}
    else {sterilizationTotal=round(Math.ceil(orderQuantity/boxCountInput)*sterilizationRate,4);sterilizationPerSet=round(sterilizationTotal/orderQuantity,4);}
  }
  const baseTotal=totalLabor===null||shippingPerSet===null||sterilizationPerSet===null||otherExpensePerSet===null?null:round(materials+totalLabor+shippingPerSet+sterilizationPerSet+otherExpensePerSet,4);
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
    baseMinutes:round(baseMinutes),baseLabor,supplement,adjustedLabor,administrativeLabor,totalLabor,excluded:round(excluded),
    shippingBoxCount,shippingTotal,shippingPerSet,sterilizationTotal,sterilizationPerSet,otherExpenseLines,otherExpensePerSet,
    baseTotal,beforeTax,costWithTax,profitAmount,taxAmount,taxLines,taxRate:totalRate,total,profitRate:profit,
    issues,warnings,missing:missing||expenseMissing||(minuteCost===null&&baseMinutes>0)||invalidTax||invalidProfit,status:missing||expenseMissing||(minuteCost===null&&baseMinutes>0)||invalidTax||invalidProfit?'Eksik verili hesap':'Hesaplandı'};
}



const time=(duration,status='known')=>({status,duration,timeType:'elapsed',unit:'minute',people:'1',output:'1',scope:'unit',description:'',note:'',surchargeIncluded:false});

function tutorialState(realSettings={}) {
  return {
    settings:{monthlySalary:'120000',monthlyHours:'200',surcharge:'0',profit:'0',displayCurrency:realSettings.displayCurrency||'TRY',eurTry:realSettings.eurTry||'',usdTry:realSettings.usdTry||'',rateDate:realSettings.rateDate||'',rateSource:realSettings.rateSource||'',ratesVerified:realSettings.ratesVerified===true},
    taxes:[{id:'tutorial-tax-1',name:'[Eğitim] KDV',rate:'20'}],
    operationNames:[...operationNames],
    fabricTypes:['Örnek kumaş'],
    materials:[{id:'tutorial-material-1',name:'[Eğitim] Örnek kumaş',code:'ORNEK-001',fabric:'Örnek kumaş',unit:'adet',price:'50',currency:'TRY'}],
    recipes:[{id:'tutorial-recipe-1',name:'[Eğitim] Alet masa örtüsü',code:'ORNEK-200',lot:'DENEME',size:'200 × 200 cm',fabric:'Örnek kumaş',gsm:'56',reinforcement:'Yok',panel:'Yok',folded:'yes',method:'production',readySource:'details',operations:[
      {name:'Pastal açma / kesim',...time('0,267'),description:'Örnek geçen süre ölçümü'},
      {name:'Bantlama ve ek bantlama',...time('0,14')},
      {name:'Katlama',...time('0,88')}
    ],readyTotal:time('1,287')}],
    profiles:[{id:'tutorial-profile-1',name:'[Eğitim] 20 setlik koli',bundleType:'Örnek bohça',bundleSize:'200 × 200 cm',rollSize:'50 × 70 cm',mode:'box',setsPerBox:'20',setsPerBag:'',rollInsert:time('','notApplicable'),rollClose:time('','notApplicable'),boxLabor:time('6'),bagLabor:time('','notApplicable')}],
    sets:[{id:'tutorial-set-1',name:'[Eğitim] Örnek set',code:'SET-DENEME',lot:'DENEME',profileId:'tutorial-profile-1',orderQuantity:'10',profitRate:'10',shippingBoxSize:'',shippingBoxPrice:'',sterilizationPerBox:'',otherExpenses:[],rows:[{recipeId:'tutorial-recipe-1',quantity:'1',materials:[{materialId:'tutorial-material-1',size:'200 × 200 cm',fabric:'Örnek kumaş',quantity:'1'}],placement:{...time('5,5'),coverage:'sets',sets:'100',description:'100 set için toplu ölçüm'}}],extras:[],taxIds:[]}]
  };
}

const tutorialSteps=[
  {tab:'sets',target:'.metrics',title:'Eğitime hoş geldiniz',text:'Üstteki sekmeler uygulamanın ana bölümleridir. Bu ekranın tamamı deneme alanıdır: [Eğitim] kayıtlarını değiştirebilir, yenilerini ekleyip silebilirsiniz. Eğitim kapatıldığında veya sayfa yenilendiğinde denemeler kaybolur; gerçek kayıtlarınız korunur.',tip:'Üstteki konu listesinden istediğiniz adıma atlayabilirsiniz.'},
  {tab:'settings',target:'[data-path="monthlySalary"]',title:'1 · Fiyatlandırma ayarları',text:'Aylık maaşı ve aylık toplam çalışma saatini girin. Uygulama saatlik, dakikalık ve saniyelik kişi maliyetini hesaplar. İşçilik ek payı ayrıdır. Buradaki kâr oranı yeni setler için varsayılandır; set ekranında değiştirilebilir. Vergiler listede tanımlanır, sette seçilir.',tip:'Örnek maaşı veya çalışma saatini değiştirin; birim ücretlere ve set sonucuna etkisini inceleyin.'},
  {tab:'materials',target:'[data-action="add"]',title:'2 · Malzeme ekleme',text:'Sol üstteki + yeni bir malzeme kartı açar. Ad, kumaş türü, stok kodu, birim ve birim fiyatını girin. Malzeme tüketimini set içeriğinde tanımlarsınız.',tip:'İsterseniz + düğmesine basıp deneme malzemesi oluşturun.'},
  {tab:'materials',target:'[data-path="price"]',title:'3 · Malzeme fiyatı ve para birimi',text:'Malzeme birimini metre, adet, metrekare veya kg olarak seçin. TL, Euro veya Dolar ile girdiğiniz fiyat TCMB kuruyla USD bazına alınır. Sonraki kur değişimlerinde hesaplanan TL fiyatı bu USD bazından güncellenir. Girilen tutar ve para birimi kartta korunur.',tip:'Örnek fiyatı değiştirin; USD bazını ve güncel TL/EUR karşılıklarını inceleyin.'},
  {tab:'settings',target:'[data-action="refresh-rates"]',title:'4 · Döviz kurları',text:'Euro ve Dolar için TCMB Döviz Satış kuru kullanılır. Tarayıcı TCMB adresini engellerse TCMB verisini yayımlayan bir ayna kullanılır. Kaynak ve veri zamanı gösterilir; bağlantı yoksa dövizli malzeme eksik verili sayılır.',tip:'Kurları yenile düğmesini, kaynağı ve veri zamanını inceleyin.'},
  {tab:'recipes',target:'[data-action="add"]',title:'5 · Yarı mamul ekleme',text:'Her ebat, kumaş, gramaj, panel, takviye veya katlama farkı için ayrı reçete açın. Aynı adlı ürünleri tek kayıtta birleştirmeyin.',tip:'İsterseniz + ile yeni yarı mamul oluşturup alanlarını doldurun.'},
  {tab:'recipes',target:'[data-path="size"]',title:'6 · Varyant bilgileri',text:'Ürün adıyla birlikte ebat, kumaş, kod ve lot aramada görünür. Katlamalı ve katlamasız ürünleri ayrı kayıtlar olarak tutun.',tip:'Ebat ve katlama alanlarını değiştirip sol listedeki görünümü inceleyin.'},
  {tab:'recipes',target:'[data-path="operations.0.people"]',title:'7 · İşçilik hesabı',text:'Birim işçilik maliyeti = çalışan kişi sayısı × geçen süre × kişi başına süre ücreti ÷ üretilen adet. İşçilik girişlerinde yalnız geçen süre kullanılır.',tip:'Çalışan sayısını değiştirip birim işçilik sonucunu inceleyin.'},
  {tab:'recipes',target:'[data-action="add-operation"]',title:'8 · İşlem listesi',text:'İşlem ekle düğmesi başlangıç listesinden bir satır açar. İşlem türü alanındaki arama simgesi seçenekleri ada göre süzer. Yeni işlem adı düğmesi listenizi genişletir. Süre boşsa o işlem hesaba katılmaz ve küçük bir uyarı görünür. Süre girilmiş ancak kişi sayısı veya üretilen adet eksikse set fiyatı eksik verili olur.',tip:'İşlem türündeki arama simgesine basıp “katlama” yazın; sonra bir işlem seçin.'},
  {tab:'recipes',target:'[data-path="operations.0.duration"]',title:'9 · Ölçüm ayrıntıları',text:'Süre birimini önce seçin. “Dakika:saniye” için 2:35 yazın; bu 2 dakika 35 saniyedir ve saniye 00–59 olmalıdır. Ondalıklı dakikada 2,5 = 2 dakika 30 saniyedir. Geçen süre seçiliyse çalışan kişi sayısını ve üretilen adedi girin. Boş veya “-” sıfır değildir.',tip:'2 kişi, 10 dakika ve 20 adet girerseniz birim süre 1 kişi-dakika olur.',prepare:'productionOperation'},
  {tab:'sets',target:'.status',title:'10 · Eksik verileri bulma',text:'Set fiyatı hesaplanmıyorsa eksik veri panelinde kayıt ve alan adıyla nedenleri görünür. Alana git düğmesi ilgili formu açar. Süre hiç girilmediyse işçilik uygulanmaz ve küçük bir uyarı çıkar; süre girilip gereken kişi sayısı boş bırakılırsa hesap eksik verili olur.',tip:'Bir işlemin çalışan kişi sayısını boş bırakıp eksik alanın nasıl gösterildiğine bakın.',prepare:'sampleSet'},
  {tab:'profiles',target:'[data-action="add"]',title:'11 · Ambalaj profilleri',text:'Bohça ve rulo ölçülerini, rulo geçirme/kapama sürelerini ve koli ya da torba işçiliğini bir profilde saklayın. Paketleme yönteminde koli, torba veya her ikisini açıkça seçin.',tip:'Yeni bir profil ekleyip paketleme yöntemini deneyebilirsiniz.'},
  {tab:'profiles',target:'[data-path="setsPerBox"]',title:'12 · Paket başına dağıtım',text:'Koli veya torba başına işçilik, içindeki set sayısına bölünür. Örnekte 6 kişi-dakika / 20 set = set başına 0,3 kişi-dakika.',tip:'Örnek profilde koli adedini veya işçilik süresini değiştirin.'},
  {tab:'sets',target:'[data-action="add"]',title:'13 · Set oluşturma',text:'Set adı, kodu ve lotunu girin; ambalaj profilini seçin. Profil değiştirmek üretim reçetesini veya malzeme fiyatını değiştirmez.',tip:'İsterseniz + düğmesiyle deneme seti oluşturun.'},
  {tab:'sets',target:'[data-action="add-set-row"]',title:'14 · Set içeriği',text:'İçerik ekle ile yarı mamul seçin. Kapalı satırda ürün adı, adet ve işçilik maliyeti görünür. Oka basınca işlem dökümü, malzemeler ve sete dizme ölçümü açılır. Malzemenin adını, ebatını, kumaş türünü ve bir adet içerik için tüketimini burada girin.',tip:'Bir içerik satırını açıp malzeme ekleyin; adet değiştiğinde malzeme maliyetinin nasıl değiştiğini izleyin.'},
  {tab:'sets',target:'.sidebar-toggle',title:'14a · Sol listeyi daraltma',text:'Sol üstteki ok düğmesi set listesini daraltır ve düzenleme alanını genişletir. Daralan şeritteki düğmeye basarak listeyi yeniden açabilirsiniz. Geçiş yumuşaktır; sistemde hareketi azalt ayarı açıksa animasyon kullanılmaz.',tip:'Sol listeyi kapatıp tekrar açın.'},
  {tab:'sets',target:'.detail-switch',title:'14b · İçerik ayrıntıları',text:'Detaylı görünüm açıkken içerik satırındaki işlem dökümü bir yarı mamul, bir set ve toplam sipariş tutarlarını gösterir. Anahtarı kapatırsanız dökümde yalnız toplam sipariş sütunu kalır. İçerik düzenleme alanları her iki durumda da kullanılabilir.',tip:'Anahtarı kapatıp bir içerik satırını açın; sonra tekrar açın.',prepare:'setRow'},
  {tab:'sets',target:'[data-path="rows.0.placement.coverage"]',title:'15 · Sete dizme kapsamı',text:'Ölçümün bir içeriği, satırdaki tüm adetleri veya belirli sayıda seti kapsadığını seçin. Tüm satırı kapsayan ölçümü içerik adediyle tekrar çarpmayın. 100 set için 5,5 kişi-dakika = 0,055 kişi-dakika/set.',tip:'Kapsamı değiştirip satırdaki dizme sonucunu inceleyin.',prepare:'setRow'},
  {tab:'sets',target:'[data-action="add-extra"]',title:'16 · Ek hazırlık işlemleri',text:'Sete özel hazırlık, taşıma veya yükleme süresi ekleyebilirsiniz. Ambalaj profilindeki rulo/koli/torba işçiliğini aynı isimle tekrar eklerseniz uygulama bunu hesaba katmaz.',tip:'Ek işlem ekleyip profil ile çakışma uyarısını deneyin.'},
  {tab:'sets',target:'.set-summary-metrics',title:'17 · Sonucu yorumlama',text:'Üstte malzeme, toplam işçilik, kargo, sterilizasyon, diğer giderler ve vergi ayrı görünür. Toplam işçilik, ek pay dahil üretim ve set işçiliği ile ona eşit idari işçilikten oluşur. Sağ üstteki ₺, $ ve € düğmeleri hangi para biriminin büyük gösterileceğini seçer.',tip:'Öne çıkan para birimini veya kâr oranını değiştirip özet kutularını izleyin.',prepare:'sampleSet'},
  {tab:'sets',target:'[data-path="profitRate"]',title:'18 · Seti tamamlama ve vergi',text:'Hedef net kâr oranını ve sipariş adedini set ekranında girin. Koli içi adet ve bir koli maliyetinden kullanılan koli sayısı yukarı yuvarlanır; son koli eksik dolsa da tam ücret alınır. Diğer giderler sipariş toplamı veya set başına eklenir. Seçtiğiniz vergiler son fiyata yansır.',tip:'Koli içi 10 set ve 14 setlik siparişte 2 koli ücretinin eklendiğini inceleyin.',prepare:'sampleSet'},
  {tab:'sets',target:'[data-path="sterilizationPerBox"]',title:'18a · Sterilizasyon gideri',text:'Sterilizasyon için yalnız bir koli başına TL maliyetini girin. Uygulama koli içi adet ve sipariş adedinden koli sayısını yukarı yuvarlar. Sterilizasyon toplamını ve set başına payını ayrı gösterir; gider son maliyete eklenir.',tip:'Koli içi 10, sipariş 14 ve sterilizasyon 50 TL girin; 2 koli için toplam 100 TL görürsünüz.',prepare:'sampleSet'},
  {tab:'sets',target:'[data-action="excel-export"]',title:'19 · Excel raporu',text:'Set başlığındaki Excel’e yazdır düğmesi özet fiyatı, içerikleri, malzemeleri, üretim ve dizme işçiliğini, ambalaj ayrıntılarını ayrı sayfalara yazar. Eksik veriler raporda da işaretlenir. Eğitim verileri kaydedilmez, bu nedenle düğme eğitim sırasında kapalıdır.',tip:'Gerçek kaydınızda eğitimi kapattıktan sonra Excel raporunu oluşturun.',prepare:'sampleSet'},
  {tab:'recipes',target:'#search',title:'20 · Arama ve kayıt yönetimi',text:'Soldaki arama alanı ad, ebat, kumaş, kod ve lota göre filtreler. Listedeki bir kayda tıklamak onu açar. Üstteki Sil düğmesi tüm kaydı, işlem veya malzeme satırındaki Kaldır düğmesi yalnız o satırı siler.',tip:'Bir anahtar kelime arayın; sonra listedeki örnek kaydı yeniden seçin.'},
  {tab:'settings',target:'.file-button',title:'21 · Kayıt ve yedek',text:'Normal kullanımda değişiklikler uygulamanın yerel depolamasına kaydedilir. JSON dışa/içe aktarma yedek içindir. Eğitim modunda kayıt ve yedek işlemleri kapalıdır; yaptığınız denemeler saklanmaz.',tip:'Eğitimi kapat düğmesi sizi gerçek verilerinize geri döndürür.'}
];



const value = x => x===null || x===undefined || x==='' ? '—' : x;
const numeric = x => x===null || x===undefined ? 'Eksik' : x;
const labelStatus = x => !hasDuration(x) ? 'Süre girilmedi' : personMinutes({...x,scope:'unit'}).missing ? 'Veri eksik' : 'Hesaplandı';
const moneyFormat = '#,##0.00 "TL"';

function tableSheet(workbook, name, title, set, columns, rows, moneyColumns=[]) {
  const sheet=workbook.addWorksheet(name,{views:[{state:'frozen',ySplit:4}]});
  sheet.columns=columns.map(([header,width],i)=>({key:'c'+i,width}));
  sheet.mergeCells(1,1,1,columns.length);
  const titleCell=sheet.getCell(1,1);
  titleCell.value=title;
  titleCell.font={name:'Aptos Display',size:18,bold:true,color:{argb:'FFFFFFFF'}};
  titleCell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF12364A'}};
  titleCell.alignment={vertical:'middle'};
  sheet.getRow(1).height=36;
  sheet.mergeCells(2,1,2,columns.length);
  sheet.getCell(2,1).value=`Set: ${set.name}  |  Kod: ${value(set.code)}  |  Lot: ${value(set.lot)}`;
  sheet.getCell(2,1).font={name:'Aptos',size:11,color:{argb:'FF3B6477'}};
  sheet.getRow(2).height=26;
  const header=sheet.getRow(4);
  header.values=columns.map(x=>x[0]);
  header.height=34;
  header.eachCell(cell=>{
    cell.font={name:'Aptos',size:10,bold:true,color:{argb:'FFFFFFFF'}};
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF087F68'}};
    cell.alignment={vertical:'middle',wrapText:true};
  });
  for(const row of rows.length?rows:[['Kayıt yok']]){
    const line=sheet.addRow(row.map(value));
    line.height=30;
    line.eachCell({includeEmpty:true},(cell,col)=>{
      cell.font={name:'Aptos',size:10,color:{argb:'FF1E3442'}};
      cell.alignment={vertical:'middle',wrapText:true};
      cell.border={bottom:{style:'hair',color:{argb:'FFDCE7EB'}}};
      if(line.number%2===0)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF2F7F8'}};
      if(moneyColumns.includes(col)&&typeof cell.value==='number')cell.numFmt=moneyFormat;
    });
  }
  sheet.autoFilter={from:{row:4,column:1},to:{row:Math.max(5,sheet.rowCount),column:columns.length}};
  sheet.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:Math.ceil(columns.length/10),fitToHeight:0,printTitlesRow:'1:4'};
  sheet.headerFooter.oddFooter='Biotex Price · Sayfa &P / &N';
  return sheet;
}

function summarySheet(workbook,set,state,calc) {
  const sheet=workbook.addWorksheet('Özet',{views:[{state:'frozen',ySplit:3}]});
  sheet.columns=[{width:34},{width:28},{width:27},{width:28},{width:25}];
  sheet.mergeCells('A1:E2');
  const title=sheet.getCell('A1');title.value='BIOTEX PRICE · SET MALİYET RAPORU';
  title.font={name:'Aptos Display',size:19,bold:true,color:{argb:'FFFFFFFF'}};
  title.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF12364A'}};
  title.alignment={vertical:'middle'};
  sheet.getRow(1).height=28;sheet.getRow(2).height=22;
  sheet.mergeCells('A3:E3');sheet.getCell('A3').value=`Rapor zamanı: ${new Date().toLocaleString('tr-TR')}`;
  sheet.getCell('A3').font={name:'Aptos',italic:true,color:{argb:'FF597482'}};
  const pair=(row,label,result,format)=>{
    sheet.getCell(row,1).value=label;sheet.getCell(row,1).font={name:'Aptos',bold:true,color:{argb:'FF456474'}};
    sheet.getCell(row,2).value=value(result);sheet.getCell(row,2).font={name:'Aptos',bold:true,color:{argb:'FF102F41'}};
    if(format&&typeof result==='number')sheet.getCell(row,2).numFmt=format;
    sheet.getRow(row).height=25;
  };
  const section=(row,text)=>{
    sheet.mergeCells(row,1,row,5);const cell=sheet.getCell(row,1);cell.value=text;
    cell.font={name:'Aptos',bold:true,color:{argb:'FFFFFFFF'}};
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF087F68'}};
    sheet.getRow(row).height=27;
  };
  section(4,'Set ve hesap durumu');
  pair(5,'Set adı',set.name);pair(6,'Kod',set.code);pair(7,'Lot',set.lot);
  pair(8,'Hesap durumu',calc.status);
  sheet.mergeCells('C8:E8');
  sheet.getCell('C8').value=calc.missing?'Eksik kalemler varsa tutarlar kesin maliyet değildir.':'Tüm hesap kalemleri doğrulandı.';
  sheet.getCell('C8').font={name:'Aptos',bold:true,color:{argb:calc.missing?'FF9B6218':'FF087F68'}};
  section(10,'Birim ücretler ve ayarlar');
  const rates=laborRates(state.settings);
  pair(11,'Aylık maaş (TL)',numeric(number(state.settings.monthlySalary)),moneyFormat);
  pair(12,'Aylık çalışma saati',numeric(number(state.settings.monthlyHours)));
  pair(13,'Saatlik kişi maliyeti',numeric(rates?.hour),moneyFormat);
  pair(14,'Dakikalık kişi maliyeti',numeric(rates?.minute),'#,##0.0000 "TL"');
  pair(15,'Saniyelik kişi maliyeti',numeric(rates?.second),'#,##0.000000 "TL"');
  pair(16,'İşçilik ek payı (%)',value(state.settings.surcharge));
  pair(17,'Bu setin hedef net kârı (%)',value(set.profitRate??state.settings.profit));
  sheet.getCell('C11').value='1 EUR (TL)';sheet.getCell('D11').value=numeric(state.settings.ratesVerified?number(state.settings.eurTry):null);
  sheet.getCell('C12').value='1 USD (TL)';sheet.getCell('D12').value=numeric(state.settings.ratesVerified?number(state.settings.usdTry):null);
  for(const address of ['C11','C12'])sheet.getCell(address).font={name:'Aptos',bold:true,color:{argb:'FF456474'}};
  section(19,'Set başına maliyet ve son fiyat');
  pair(20,'Malzeme maliyeti',calc.materials,moneyFormat);
  pair(21,'Üretim işçiliği (kişi-dk)',calc.production);
  pair(22,'Sete dizme (kişi-dk)',calc.placement);
  pair(23,'Hazırlama ve ambalaj (kişi-dk)',calc.preparation);
  pair(24,'Temel işçilik',numeric(calc.baseLabor),moneyFormat);
  pair(25,'İşçilik ek payı',numeric(calc.supplement),moneyFormat);
  pair(26,'Düzeltilmiş işçilik',numeric(calc.adjustedLabor),moneyFormat);
  for(const [row,label,amount] of [[20,'Kargo / set',calc.shippingPerSet],[21,'Sterilizasyon / set',calc.sterilizationPerSet],[22,'Diğer giderler / set',calc.otherExpensePerSet],[23,'İdari işçilik / set',calc.administrativeLabor],[24,'Toplam işçilik / set',calc.totalLabor],[25,'Temel maliyet / set',calc.baseTotal]]){
    sheet.getCell(row,3).value=label;sheet.getCell(row,3).font={name:'Aptos',bold:true,color:{argb:'FF456474'}};
    sheet.getCell(row,4).value=numeric(amount);sheet.getCell(row,4).numFmt=moneyFormat;
  }
  pair(27,'Vergi öncesi satış',numeric(calc.beforeTax),moneyFormat);
  pair(28,'Seçili vergiler',calc.taxLines.length?calc.taxLines.map(x=>x.name).join(', '):'Yok');
  pair(29,'Toplam vergi oranı (%)',calc.taxRate);
  pair(30,'Vergi gideri',numeric(calc.taxAmount),moneyFormat);
  pair(31,'Son satış fiyatı',numeric(calc.total),moneyFormat);
  const fxTotal=calc.missing||state.settings.ratesVerified!==true?null:calc.total;
  const eurRate=number(state.settings.eurTry),usdRate=number(state.settings.usdTry);
  pair(32,'Son fiyat (EUR)',numeric(fxTotal!==null&&eurRate>0?fxTotal/eurRate:null),'#,##0.00 "EUR"');
  pair(33,'Son fiyat (USD)',numeric(fxTotal!==null&&usdRate>0?fxTotal/usdRate:null),'#,##0.00 "USD"');
  sheet.getCell('B31').font={name:'Aptos Display',size:16,bold:true,color:{argb:'FF087F68'}};
  sheet.mergeCells('A34:E34');
  sheet.getCell('A34').value=`Dövizli malzemeler TCMB Döviz Satış kuru ile çevrilir. Kaynak: ${state.settings.rateSource||'TCMB Döviz Satış'}. Veri tarihi: ${state.settings.ratesVerified?state.settings.rateDate:'kur alınamadı'}.`;
  sheet.getCell('A34').font={name:'Aptos',italic:true,color:{argb:'FF597482'}};
  sheet.mergeCells('A35:E35');
  sheet.getCell('A35').value='İdari işçilik = düzeltilmiş işçilik. Temel maliyet = malzeme + toplam işçilik + kargo + sterilizasyon + diğer giderler. Vergi öncesi satış = temel maliyet × (1 + hedef kâr / 100). Her vergi = vergi öncesi satış × oran / 100. Son fiyat = vergi öncesi satış + vergiler.';
  sheet.getCell('A35').alignment={wrapText:true,vertical:'middle'};
  sheet.getRow(35).height=36;
  sheet.getCell('A36').value='Seçilen vergilerin dökümü';sheet.getCell('A36').font={name:'Aptos',bold:true};
  calc.taxLines.forEach((tax,i)=>{
    sheet.getCell(37+i,1).value=tax.name;
    sheet.getCell(37+i,2).value=tax.rate;
    sheet.getCell(37+i,3).value=numeric(tax.amount);
    sheet.getCell(37+i,3).numFmt=moneyFormat;
  });
  const orderRow=38+calc.taxLines.length;
  section(orderRow,'Sipariş toplamları ve net kâr');
  const orderQty=number(set.orderQuantity??'1');
  const valid=Number.isInteger(orderQty)&&orderQty>0&&!calc.missing;
  pair(orderRow+1,'Sipariş adedi (set)',valid?orderQty:'Eksik');
  pair(orderRow+2,'Set başına toplam maliyet',numeric(calc.costWithTax),moneyFormat);
  pair(orderRow+3,'Set başına net kâr',numeric(calc.profitAmount),moneyFormat);
  pair(orderRow+4,'Sipariş temel maliyeti',numeric(valid?calc.baseTotal*orderQty:null),moneyFormat);
  pair(orderRow+5,'Sipariş vergi gideri',numeric(valid?calc.taxAmount*orderQty:null),moneyFormat);
  pair(orderRow+6,'Sipariş toplam maliyeti',numeric(valid?calc.costWithTax*orderQty:null),moneyFormat);
  pair(orderRow+7,'Sipariş toplam net kârı',numeric(valid?calc.profitAmount*orderQty:null),moneyFormat);
  pair(orderRow+8,'Sipariş toplam satışı',numeric(valid?calc.total*orderQty:null),moneyFormat);
  sheet.pageSetup={paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0};
  return sheet;
}

function buildSetWorkbook(set,state,ExcelJS) {
  if(!ExcelJS?.Workbook)throw Error('Excel oluşturma bileşeni yüklenemedi.');
  const workbook=new ExcelJS.Workbook();
  workbook.creator='Biotex Price';
  workbook.created=new Date();
  const calc=calculateSet(set,state), minuteRate=laborRates(state.settings)?.minute??null;
  summarySheet(workbook,set,state,calc);
  const expenseRows=[['Kargo','Koli başına sabit kargo','Koli',numeric(number(set.shippingBoxPrice)),numeric(number(set.shippingBoxSize)),numeric(calc.shippingBoxCount),numeric(calc.shippingTotal),numeric(calc.shippingPerSet)],['Sterilizasyon','Koli başına sterilizasyon','Koli',numeric(number(set.sterilizationPerBox)),numeric(number(set.shippingBoxSize)),numeric(calc.shippingBoxCount),numeric(calc.sterilizationTotal),numeric(calc.sterilizationPerSet)]];
  for(const line of calc.otherExpenseLines||[])expenseRows.push(['Diğer gider',value(line.expense.name),line.scope==='unit'?'Set başına':'Sipariş toplamı',numeric(line.amount),'','',numeric(line.amount===null?null:line.scope==='unit'&&number(set.orderQuantity)>0?line.amount*number(set.orderQuantity):line.amount),numeric(line.perSet)]);
  tableSheet(workbook,'Ek Giderler','Kargo, sterilizasyon ve diğer giderlerin set başına dağılımı',set,
    [['Tür',18],['Gider adı',32],['Kapsam',20],['Girilen tutar TL',20],['Koli içi set',17],['Koli sayısı',16],['Toplam TL',20],['Set başına TL',20]],expenseRows,[4,7,8]);
  const contentRows=(set.rows||[]).map((row,i)=>{
    const recipe=state.recipes.find(x=>x.id===row.recipeId),result=calc.rows[i];
    return [i+1,value(recipe?.name),value(recipe?.code),value(recipe?.lot),value(recipe?.size),
      value(recipe?.fabric),value(recipe?.gsm),value(recipe?.reinforcement),value(recipe?.panel),
      recipe?.folded==='yes'?'Katlamalı':recipe?.folded==='no'?'Katlamasız':'Belirtilmedi',
      numeric(number(row.quantity)),numeric(result?.labor?.value),numeric(result?.placing?.value),
      numeric(result?.material),result?.missing?'Veri eksik':'Doğrulanmış'];
  });
  tableSheet(workbook,'Set İçeriği','Set içeriği ve varyantlar',set,
    [['No',7],['Yarı mamul',29],['Kod',17],['Lot',17],['Ebat',19],['Kumaş',22],['Gramaj',12],
      ['Takviye',19],['Panel',19],['Katlama',16],['Sette adet',13],['Üretim kişi-dk/adet',19],
      ['Dizme kişi-dk/set',18],['Malzeme TL/set',19],['Durum',16]],contentRows,[14]);
  const materialRows=[];
  for(const row of set.rows||[]){
    const recipe=state.recipes.find(x=>x.id===row.recipeId),setQty=number(row.quantity);
    for(const line of row.materials||[]){
      const material=state.materials.find(x=>x.id===line.materialId);
      const qty=number(line.quantity),priceTL=materialPriceTL(material,state.settings);
      const total=qty!==null&&setQty!==null&&priceTL!==null?qty*setQty*priceTL:null;
      materialRows.push([value(recipe?.name),value(material?.name),value(line.size),value(line.fabric),value(material?.code),
        numeric(qty),numeric(setQty),qty!==null&&setQty!==null?qty*setQty:'Eksik',
        value(material?.unit),value(material?.currency||'TRY'),numeric(number(material?.price)),
        numeric(number(material?.usdBasePrice)),numeric(state.settings.ratesVerified?number(state.settings.usdTry):null),numeric(priceTL),numeric(total),
        total===null?'Veri eksik':'Doğrulanmış']);
    }
  }
  tableSheet(workbook,'Malzemeler','Malzeme maliyeti ayrıntıları',set,
    [['Yarı mamul',27],['Malzeme',27],['Ebat',18],['Kumaş türü',20],['Stok kodu',17],['Miktar/adet',15],['Sette adet',13],
      ['Toplam miktar',16],['Birim',14],['Giriş para birimi',17],['Girilen fiyat',17],
      ['USD baz fiyat',18],['USD/TL kuru',14],['Güncel fiyat TL',18],['Toplam TL',18],['Durum',17]],materialRows,[14,15]);
  const productionRows=[];
  for(const row of set.rows||[]){
    const recipe=state.recipes.find(x=>x.id===row.recipeId);
    if(!recipe)continue;
    const qty=number(row.quantity),selectedTotal=recipe.method==='ready'&&recipe.readySource==='total';
    const entries=[...(recipe.operations||[]).map(x=>({name:x.name,entry:x,used:!selectedTotal,scope:recipe.method==='production'?'batch':'unit'})),
      {name:'Hazır / referans toplam',entry:recipe.readyTotal,used:selectedTotal,scope:'unit'}];
    for(const {name,entry,used,scope} of entries){
      const minutes=personMinutes({...entry,scope});
      const unitCost=minutes.missing||minuteRate===null?null:minutes.value*minuteRate;
      productionRows.push([value(recipe.name),value(recipe.method==='production'?'Üretim ölçümü':'Hazır birim işçilik'),
        value(name),used?'Evet':'Hayır · referans',labelStatus(entry),
        entry?.timeType==='elapsed'?'Geçen süre':'Kişi-dakika',value(entry?.duration),
        value(entry?.unit),value(entry?.people),value(entry?.output),numeric(minutes.missing?null:minutes.value),
        numeric(qty),used?numeric(unitCost):'Referans',used&&unitCost!==null&&qty!==null?unitCost*qty:used?'Eksik':'Referans',
        entry?.surchargeIncluded?'Evet':'Hayır',value(entry?.description),value(entry?.note)]);
    }
  }
  tableSheet(workbook,'Üretim İşçiliği','Yarı mamul üretim işçiliği',set,
    [['Yarı mamul',27],['Yöntem',20],['İşlem',28],['Hesaba esas',18],['Veri durumu',16],
      ['Süre türü',17],['Süre',13],['Birim',15],['Kişi',11],['Üretilen adet',16],
      ['Kişi-dk/adet',16],['Sette adet',13],['TL/adet',16],['Toplam TL',17],
      ['Ek pay dahil',15],['Açıklama',28],['Ölçüm notu',28]],productionRows,[13,14]);
  const placementRows=(set.rows||[]).map((row,i)=>{
    const recipe=state.recipes.find(x=>x.id===row.recipeId),p=row.placement,result=placementLabor(p,row.quantity);
    const cost=result.missing||minuteRate===null?null:result.value*minuteRate;
    return [value(recipe?.name),numeric(number(row.quantity)),
      p?.coverage==='item'?'Bir adet içerik':p?.coverage==='row'?'Satırdaki tüm adetler':'Toplu set ölçümü',
      labelStatus(p),p?.timeType==='elapsed'?'Geçen süre':'Kişi-dakika',
      value(p?.duration),value(p?.unit),value(p?.people),value(p?.sets),
      numeric(result.missing?null:result.value),numeric(cost),value(p?.description),value(p?.note)];
  });
  tableSheet(workbook,'Sete Dizme','Sete dizme işçiliği',set,
    [['Yarı mamul',27],['Sette adet',13],['Ölçüm kapsamı',23],['Durum',17],['Süre türü',18],
      ['Süre',13],['Birim',15],['Kişi',10],['Ölçülen set',15],['Kişi-dk/set',17],
      ['TL/set',16],['Açıklama',28],['Ölçüm notu',28]],placementRows,[11]);
  const profile=state.profiles.find(x=>x.id===set.profileId);
  const packagingRows=[
    ['Profil',value(profile?.name),'', '', '', '', '', ''],
    ['Bohça',value(profile?.bundleType),value(profile?.bundleSize),'', '', '', '', ''],
    ['Rulo ölçüsü',value(profile?.rollSize),'', '', '', '', '', ''],
    ['Paketleme yöntemi',profile?.mode==='both'?'Koli ve torba':profile?.mode==='box'?'Koli':profile?.mode==='bag'?'Torba':'Yok','','','','','',''],
    ['Koli içindeki set',value(profile?.setsPerBox),'','','','','',''],
    ['Torba içindeki set',value(profile?.setsPerBag),'','','','','','']
  ];
  for(const part of calc.packaging.parts){
    const cost=minuteRate===null||part.missing?null:part.value*minuteRate;
    packagingRows.push([part.label,'Profil işçiliği',part.missing?'Veri eksik':'Doğrulanmış',
      part.value,numeric(cost),'Set başına','','']);
  }
  for(const extra of calc.extras){
    const cost=minuteRate===null||extra.missing||extra.duplicate?null:extra.value*minuteRate;
    packagingRows.push([value(extra.item?.name),'Set ek işlemi',
      extra.duplicate?'Profilde var · hesaba katılmadı':extra.missing?'Veri eksik':'Doğrulanmış',
      extra.value,numeric(cost),value(extra.item?.description),value(extra.item?.note),
      extra.item?.surchargeIncluded?'Ek pay dahil':'']);
  }
  tableSheet(workbook,'Ambalaj','Set hazırlama ve ambalaj',set,
    [['Kalem',26],['Kaynak / değer',27],['Durum / ölçü',30],['Kişi-dk/set',18],
      ['TL/set',18],['Açıklama',30],['Ölçüm notu',27],['Ek pay',18]],packagingRows,[5]);
  return workbook;
}



const KEY='btxprice-v1';
const id=()=>crypto.randomUUID();
const emptyTime=(scope='unit')=>({status:'missing',duration:'',timeType:'elapsed',unit:'minute',people:'',output:'',scope,description:'',note:'',surchargeIncluded:false});
const timeUnits=[['minute','Dakika (ondalıklı)'],['minuteSecond','Dakika:saniye (dk:sn)'],['hour','Saat (ondalıklı)']];
const blankRecipe=()=>({id:id(),name:'Yeni yarı mamul',code:'',lot:'',size:'',fabric:'',gsm:'',reinforcement:'',panel:'',folded:'',method:'production',readySource:'details',operations:[],readyTotal:emptyTime()});
const blankProfile=()=>({id:id(),name:'Yeni ambalaj profili',bundleType:'',bundleSize:'',rollSize:'',mode:'none',setsPerBox:'',setsPerBag:'',rollInsert:emptyTime(),rollClose:emptyTime(),boxLabor:emptyTime(),bagLabor:emptyTime()});
const blankSet=()=>({id:id(),name:'Yeni set',code:'',lot:'',profileId:'',orderQuantity:'1',profitRate:String(state?.settings?.profit??'0'),shippingBoxSize:'',shippingBoxPrice:'',sterilizationPerBox:'',otherExpenses:[],rows:[],extras:[],taxIds:[]});
const initial=()=>({settings:{monthlySalary:'',monthlyHours:'',surcharge:'0',profit:'0',eurTry:'',usdTry:'',ratesVerified:false},taxes:[],operationNames:[...operationNames],fabricTypes:[],materials:[],recipes:[],profiles:[],sets:[]});
let state; try {state=JSON.parse(localStorage.getItem(KEY))||globalThis.__BTXPRICE_SEED__||initial();} catch {state=initial();}
function indexMaterialPrice(material,settings,{force=false}={}){
  if(!force && number(material.usdBasePrice)!==null){material.usdIndexPending=false;return true;}
  const price=number(material.price),currency=material.currency||'TRY';
  const usd=number(settings.usdTry),eur=number(settings.eurTry);
  let base=null;
  if(price!==null && price>=0){
    if(currency==='USD')base=price;
    else if(settings.ratesVerified===true && usd>0 && currency==='TRY')base=price/usd;
    else if(settings.ratesVerified===true && usd>0 && eur>0 && currency==='EUR')base=price*eur/usd;
  }
  if(base===null){delete material.usdBasePrice;material.usdIndexPending=true;return false;}
  material.usdBasePrice=String(base);material.usdIndexPending=false;
  material.indexRateDate=settings.rateDate||'';
  return true;
}
function indexAllMaterials(data){for(const material of data.materials||[])indexMaterialPrice(material,data.settings);}
function normalizeState(data){
  data.settings ||= initial().settings;
  data.settings.ratesVerified=false;
  data.taxes ||= [];
  data.fabricTypes ||= [];
  if(data.settings.tax!==undefined && !data.taxes.some(x=>x.id==='legacy-standard'))
    data.taxes.unshift({id:'legacy-standard',name:'Standart vergi',rate:String(data.settings.tax)});
  delete data.settings.tax;
  for(const set of data.sets||[]) {
    if(!Array.isArray(set.taxIds))set.taxIds=set.includeTax===true?['legacy-standard']:[];
    if(set.profitRate===undefined)set.profitRate=String(data.settings.profit??'0');
    if(!Array.isArray(set.otherExpenses))set.otherExpenses=[];
  }
  migrateLegacySetData(data);
  indexAllMaterials(data);
  return data;
}
state=normalizeState(state);
let rateLoading=false,rateError='';
function parseTcmbRates(xml){
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.querySelector('parsererror'))throw Error('TCMB kur verisi okunamadı.');
  const root=doc.documentElement;
  const date=root?.getAttribute('Tarih');
  if(root?.nodeName!=='Tarih_Date'||!/^\d{2}\.\d{2}\.\d{4}$/.test(date||''))throw Error('TCMB bülten tarihi geçersiz.');
  const read=code=>{
    const item=[...doc.getElementsByTagName('Currency')].find(x=>x.getAttribute('Kod')===code);
    const unit=number(item?.getElementsByTagName('Unit')[0]?.textContent);
    const selling=number(item?.getElementsByTagName('ForexSelling')[0]?.textContent);
    if(!unit||unit<1||!selling||selling<=0)throw Error(code+' döviz satış kuru eksik.');
    return selling/unit;
  };
  return {date,eur:read('EUR'),usd:read('USD')};
}
async function refreshRates(){
  if(rateLoading)return;
  const currentState=state;
  rateLoading=true;rateError='';currentState.settings.ratesVerified=false;render();
  try{
    let rates;
    if(window.desktopFiles?.fetchTcmbRates){
      rates=parseTcmbRates(await window.desktopFiles.fetchTcmbRates());
      rates.source='TCMB Döviz Satış';
    }else{
      try{
        const response=await fetch('https://www.tcmb.gov.tr/kurlar/today.xml',{cache:'no-store',signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw Error(`TCMB bağlantısı: HTTP ${response.status}`);
        rates=parseTcmbRates(await response.text());
        rates.source='TCMB Döviz Satış';
      }catch{
        const response=await fetch('https://raw.githubusercontent.com/MehmetAkgul/currency-api-tr/main/v1/currencies/try-full.json',{cache:'no-store',signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw Error(`TCMB veri aynası: HTTP ${response.status}`);
        const data=await response.json();
        const eur=data?.try?.eur,usd=data?.try?.usd;
        if(eur?.source!=='tcmb'||usd?.source!=='tcmb'||eur?.stale!==false||usd?.stale!==false)
          throw Error('Veri aynasında TCMB kaynaklı ve güncel işaretli kur bulunamadı.');
        const eurRate=number(eur.ask),usdRate=number(usd.ask);
        const updatedAt=Date.parse(data.updated_at);
        if(!(eurRate>0&&usdRate>0)||!Number.isFinite(updatedAt)||updatedAt>Date.now()+300000||Date.now()-updatedAt>86400000)
          throw Error('TCMB veri aynasındaki kur veya güncelleme zamanı geçersiz.');
        const date=new Date(updatedAt).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul',dateStyle:'short',timeStyle:'short'});
        rates={eur:eurRate,usd:usdRate,date:`${date} (ayna kaydı)`,source:'TCMB Döviz Satış · veri aynası'};
      }
    }
    const rateValues={eurTry:String(rates.eur),usdTry:String(rates.usd),rateDate:rates.date,
      ratesFetchedAt:new Date().toISOString(),ratesVerified:true,rateSource:rates.source};
    Object.assign(currentState.settings,rateValues);
    indexAllMaterials(currentState);
    if(tutorial&&currentState===tutorial.realState)Object.assign(state.settings,rateValues);
    if(tutorial&&currentState===tutorial.realState)indexAllMaterials(state);
    if(!tutorial)save();
  }catch(err){rateError=err.message||String(err);}
  finally{rateLoading=false;if(currentState===state||(tutorial&&currentState===tutorial.realState))render();}
}

let tab='sets',selected={sets:state.sets[0]?.id,recipes:state.recipes[0]?.id,profiles:state.profiles[0]?.id,materials:state.materials[0]?.id};
let tutorial=null,finalizing=false;
let expandedSetRows=new Set();
let sidebarCollapsed=false,detailedView=true;
let detailViewChanged=false;
let lastRenderedViewKey='';
let renderVersion=0,pointerPressActive=false,pendingChangeRender=false,pendingRenderVersion=0;
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(n,d=3)=>n===null||n===undefined?'—':new Intl.NumberFormat('tr-TR',{maximumFractionDigits:d,minimumFractionDigits:d}).format(n);
const plainMoney=(tl,code,digits=2)=>{
  if(tl===null||tl===undefined||!Number.isFinite(tl))return '—';
  const rate=code==='TRY'?1:number(code==='EUR'?state.settings.eurTry:state.settings.usdTry);
  if(code!=='TRY'&&(state.settings.ratesVerified!==true||!(rate>0)))return '—';
  return new Intl.NumberFormat('tr-TR',{style:'currency',currency:code,minimumFractionDigits:digits===4?4:2,maximumFractionDigits:digits===4?6:2}).format(tl/rate);
};
const moneyStack=(tl,digits=2)=>{
  const main=['TRY','USD','EUR'].includes(state.settings.displayCurrency)?state.settings.displayCurrency:'TRY';
  const others=['TRY','USD','EUR'].filter(code=>code!==main);
  return `<span class="money-stack"><span class="money-main">${plainMoney(tl,main,digits)}</span><small class="money-other">${others.map(code=>`${code==='TRY'?'TL':code} ${plainMoney(tl,code,digits)}`).join(' · ')}</small></span>`;
};
const money=n=>moneyStack(n,2);
const money4=n=>moneyStack(n,4);
const foreignMoney=(tl,code)=>{
  const rate=number(code==='EUR'?state.settings.eurTry:state.settings.usdTry);
  return tl===null||state.settings.ratesVerified!==true||rate===null||rate<=0?'—':
    new Intl.NumberFormat('tr-TR',{style:'currency',currency:code,maximumFractionDigits:2}).format(tl/rate);
};
const foreignLaborMoney=(tl,code)=>{
  const rate=number(code==='EUR'?state.settings.eurTry:state.settings.usdTry);
  return tl===null||state.settings.ratesVerified!==true||rate===null||rate<=0?'—':
    new Intl.NumberFormat('tr-TR',{style:'currency',currency:code,minimumFractionDigits:4,maximumFractionDigits:6}).format(tl/rate);
};
const laborCurrencies=tl=>money4(tl);
function setSummaryCards(c){
  const verifiedTotal=c.missing?null:c.total;
  return `<div class="metrics set-summary-metrics">
    <div><small>Malzeme</small><strong>${money(c.materials)}</strong></div>
    <div><small>Toplam işçilik</small><strong>${money(c.totalLabor)}</strong><span class="labor-extra">Üretim ve set işçiliği: ${money(c.adjustedLabor)}<br>Ek pay: ${money(c.supplement)}<br>İdari işçilik: ${money(c.administrativeLabor)}</span></div>
    <div><small>Kargo · set başına</small><strong>${money(c.shippingPerSet)}</strong></div>
    <div><small>Sterilizasyon · set başına</small><strong>${money(c.sterilizationPerSet)}</strong></div>
    <div><small>Diğer giderler · set başına</small><strong>${money(c.otherExpensePerSet)}</strong></div>
    <div><small>Vergi · set başına</small><strong>${money(c.missing?null:c.taxAmount)}</strong></div>
    <div class="accent sale-summary"><small>Planlanan satış · vergiler dahil</small><strong>${money(verifiedTotal)}</strong>${state.settings.ratesVerified?'':`<span class="fx-status">${rateLoading?'Kurlar yükleniyor':'Kur alınamadı'}</span>`}<button type="button" class="sale-refresh" data-action="refresh-rates" ${rateLoading?'disabled':''}>${rateLoading?'Güncelleniyor…':'Kurları yenile'}</button></div>
  </div>`;
}
function timeWarnings(c){
  if(!c.warnings?.length)return '';
  return `<div class="time-warning-list"><strong>Hesaba katılmayan kalemler</strong><ul>${c.warnings.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`;
}
function missingPanel(c,set,orderValid){
  const issues=[...(c.issues||[])];
  if(!orderValid)issues.push({message:'Sipariş adedi: sıfırdan büyük tam sayı girin.',tab:'sets',recordId:set.id,path:'orderQuantity'});
  if(c.missing&&!issues.length)issues.push({message:'Hesapta eksik veri var; işçilik ve malzeme kayıtlarını kontrol edin.',tab:'sets',recordId:set.id});
  if(!issues.length)return '';
  return `<div class="card missing-panel"><h3>Fiyatı hesaplamak için tamamlanacak alanlar (${issues.length})</h3><p>Yukarıdaki malzeme ve işçilik rakamları yalnız girilmiş verilerin ara toplamıdır; eksik kalemler tamamlanınca son fiyat gösterilir.</p><ul>${issues.map(x=>`<li><span>${esc(x.message)}</span><button type="button" class="secondary" data-action="fix-missing" data-fix-tab="${esc(x.tab)}" data-fix-id="${esc(x.recordId||'')}" data-fix-path="${esc(x.path||'')}">Alana git</button></li>`).join('')}</ul></div>`;
}
const save=()=>{if(!tutorial)localStorage.setItem(KEY,JSON.stringify(state));};
async function exportSetXlsx(set){
  const workbook=buildSetWorkbook(set,state,window.ExcelJS);
  const bytes=new Uint8Array(await workbook.xlsx.writeBuffer());
  const name=String(set.name||'set').replace(/[<>:"/\\|?*]/g,'_').slice(0,70);
  const filename=`Biotex-Set-Maliyet-${name}.xlsx`;
  if(window.desktopFiles?.saveXlsx){
    const result=await window.desktopFiles.saveXlsx(filename,bytes);
    if(!result?.canceled)showAppNotice(`Excel raporu kaydedildi: ${result.filePath}`);
    return;
  }
  const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
const target=kind=>Array.isArray(state[kind])?state[kind].find(x=>x.id===selected[kind]):null;
function capturePriceSnapshots(){
  let changed=false;
  for(const set of state.sets||[])for(const row of set.rows||[]){
    if(row.priceSnapshot?.recipeId===row.recipeId)continue;
    const snapshot=setRowUnitCosts(row,state);
    if(snapshot){row.priceSnapshot=snapshot;changed=true;}
    else if(row.priceSnapshot){delete row.priceSnapshot;changed=true;}
  }
  if(changed)save();
}
function rowPriceChange(row){
  return setRowPriceChange(row.priceSnapshot,row,state);
}
function priceChangeTag(row){
  const change=rowPriceChange(row);
  if(!change?.materialChanged&&!change?.laborChanged)return '';
  return `<span class="price-change-tag">Fiyat değişti${change.materialChanged?' · malzeme':''}${change.laborChanged?' · işçilik':''}</span>`;
}
function priceChangeDetail(row,index){
  const change=rowPriceChange(row);
  if(!change?.materialChanged&&!change?.laborChanged)return '';
  const before=row.priceSnapshot;
  return `<div class="price-change-detail"><strong>Güncel yarı mamul fiyatı sete yansıtıldı</strong><div>${change.materialChanged?`<span>Malzeme: ${money4(before.material)} → ${money4(change.current.material)} / adet</span>`:''}${change.laborChanged?`<span>Üretim işçiliği: ${money4(before.labor)} → ${money4(change.current.labor)} / adet</span>`:''}</div><button type="button" class="secondary" data-action="accept-price" data-index="${index}">Yeni fiyatı referans al</button></div>`;
}
const options=(values,current)=>values.map(([v,t])=>`<option value="${esc(v)}" ${String(v)===String(current)?'selected':''}>${esc(t)}</option>`).join('');
function input(label,path,value,type='text',hint='') {return `<label class="field"><span>${esc(label)}</span><input data-path="${esc(path)}" type="${type}" value="${esc(value)}" ${type==='number'?'step="any"':''} placeholder="${esc(hint)}"></label>`;}
function durationInput(path,entry){const unit=entry.unit||'minute';const label=unit==='minuteSecond'?'Geçen süre (dk:sn)':unit==='hour'?'Geçen süre (saat)':'Geçen süre (dakika)';const hint=unit==='minuteSecond'?'ör. 2:35 (2 dk 35 sn)':unit==='hour'?'ör. 0,5':'ör. 2,5';return input(label,path,entry.duration,'text',hint);}
function select(label,path,value,items){return `<div class="field"><span>${esc(label)}</span><div class="select-with-search"><select data-path="${esc(path)}" aria-label="${esc(label)}">${options(items,value)}</select>${items.length>1?`<button type="button" class="select-search-toggle" data-select-search-toggle aria-label="${esc(label)} seçeneklerinde ara" title="Seçeneklerde ara">⌕</button>`:''}</div>${items.length>1?`<input class="select-search-input" type="search" data-select-search placeholder="${esc(label)} içinde ara…" aria-label="${esc(label)} içinde ara" hidden>`:''}</div>`;}
function fabricSelect(path,value){
  const values=[...new Set([...(state.fabricTypes||[]),...state.materials.map(x=>x.fabric),...state.recipes.map(x=>x.fabric),...state.sets.flatMap(set=>set.rows?.flatMap(row=>row.materials?.map(x=>x.fabric)||[])||[]),value].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'tr'));
  return select('Kumaş türü',path,value,[['','Seçin / uygulanmıyor'],...values.map(x=>[x,x])]);
}
function check(label,path,value){return `<label class="check"><input type="checkbox" data-path="${esc(path)}" ${value?'checked':''}><span>${esc(label)}</span></label>`;}
function nav(){const tabs=[['sets','Setler'],['recipes','Yarı mamuller'],['materials','Malzemeler'],['profiles','Ambalaj profilleri'],['settings','Ayarlar']];$('#nav').innerHTML=tabs.map(([k,v])=>`<button data-tab="${k}" class="${tab===k?'active':''}">${v}</button>`).join('');}
function renderCurrencyToggle(){
  const container=$('#currency-toggle');if(!container)return;
  const current=['TRY','USD','EUR'].includes(state.settings.displayCurrency)?state.settings.displayCurrency:'TRY';
  container.innerHTML=[['TRY','₺','TL'],['USD','$','Dolar'],['EUR','€','Euro']].map(([code,symbol,label])=>
    `<button type="button" data-action="display-currency" data-currency="${code}" class="${current===code?'active':''}" aria-label="${label} öne çıksın" aria-pressed="${current===code}" title="${label} öne çıksın">${symbol}</button>`).join('');
}
function sidebar(kind,title,caption){const records=state[kind]; const q=($('#search')?.value||'').toLocaleLowerCase('tr'); return `<aside class="sidebar"><button type="button" class="sidebar-toggle" data-action="toggle-sidebar" aria-label="${sidebarCollapsed?'Sol listeyi aç':'Sol listeyi daralt'}" aria-expanded="${!sidebarCollapsed}" title="${sidebarCollapsed?'Listeyi aç':'Listeyi daralt'}">${sidebarCollapsed?'☰':'‹'}</button><div class="sidebar-content"><div class="side-head"><div><h2>${title}</h2><small>${caption}</small></div><button class="primary square" data-action="add" data-kind="${kind}" title="Yeni kayıt">+</button></div><input id="search" placeholder="Ara: ad, ebat, kumaş, kod / lot" value="${esc(q)}"><div class="record-list">${records.filter(x=>`${x.name} ${x.size||''} ${x.fabric||''} ${x.code||''} ${x.lot||''}`.toLocaleLowerCase('tr').includes(q)).map(x=>`<button class="record ${selected[kind]===x.id?'selected':''}" data-action="select" data-kind="${kind}" data-id="${x.id}"><strong>${esc(x.name)}</strong>${kind==='sets'&&x.rows?.some(row=>{const change=rowPriceChange(row);return change?.materialChanged||change?.laborChanged})?'<span class="price-change-tag">Fiyat değişti</span>':''}<small>${esc([x.size,x.fabric,x.code,x.lot].filter(Boolean).join(' · '))}</small></button>`).join('')||'<p class="muted pad">Henüz kayıt yok.</p>'}</div></div></aside>`;}
function timeForm(base,e,{batch=false,showSurcharge=false}={}){const invalidClock=hasDuration(e)&&e.unit==='minuteSecond'&&durationMinutes(e)===null;return `<div class="grid cols-4">${durationInput(`${base}.duration`,e)}${select('Süre birimi',`${base}.unit`,e.unit||'minute',timeUnits)}${input('Çalışan kişi sayısı',`${base}.people`,e.people,'number','süre boyunca çalışan kişi')}${batch?input('Üretilen adet',`${base}.output`,e.output,'number','parti adedi'):''}</div><p class="muted">${e.unit==='minuteSecond'?'Dakika:saniye biçiminde yazın: 2:35 = 2 dakika 35 saniye. Saniyeyi iki haneli (00–59) yazın.':e.unit==='hour'?'Saati ondalıklı yazın: 0,5 = 30 dakika.':'Dakikayı ondalıklı yazın: 2,5 = 2 dakika 30 saniye.'} Geçen süre × çalışan kişi sayısı${batch?' ÷ üretilen adet':''} uygulanır.</p>${!hasDuration(e)?'<p class="time-hint">⚠ Süre girilmedi; bu işçilik hesaba katılmıyor.</p>':''}${e.timeType!=='elapsed'&&hasDuration(e)?`<p class="warning">Eski kişi-dakika kaydı hesaplanmaz. <button type="button" class="secondary" data-action="convert-time" data-path="${base}">Geçen süreye geç</button> (süreyi yeniden girin).</p>`:''}${invalidClock?'<p class="warning">Geçersiz süre. Örnek doğru giriş: 2:35. Saniye iki haneli ve 00–59 aralığında olmalı.</p>':''}<div class="grid cols-2">${input('Açıklama',`${base}.description`,e.description)}${input('Ölçüm notu',`${base}.note`,e.note)}</div>${showSurcharge?check('Hazır sürede işçilik ek payı zaten var',`${base}.surchargeIncluded`,e.surchargeIncluded):''}`;}
function laborFormulaHelp(){const rates=laborRates(state.settings);return `<div class="subcard"><h4>Üretim ölçümü nasıl hesaplanır?</h4><p><b>Birim işçilik maliyeti = çalışan kişi sayısı × geçen süre × kişi başına süre ücreti ÷ üretilen adet.</b></p><p>Dakika, saat veya dk:sn seçebilirsiniz. Örnek: 2 kişi × 10 dakika × 10 TL/dakika ÷ 20 adet = 10 TL/adet.</p><p>Güncel kişi maliyeti: ${rates?`${fmt(rates.minute,4)} TL/dakika · ${fmt(rates.hour,4)} TL/saat`:'Ayarlar bölümünde aylık maaş ve çalışma saatini girin.'}</p></div>`;}
function recipeView(){const r=target('recipes');if(!r)return empty('Yarı mamul ekleyerek başlayın.');const labor=recipeLabor(r);return `<section class="editor"><div class="editor-head"><div><p class="eyebrow">YARI MAMUL REÇETESİ</p><h1>${esc(r.name)}</h1><p>Varyant bilgileri aynı adlı ürünleri ayırır.</p></div><button class="danger ghost" data-action="delete" data-kind="recipes">Sil</button></div><div class="card"><h3>Kimlik ve varyant</h3><div class="grid cols-4">${input('Ürün adı','name',r.name)}${input('Ebat','size',r.size)}${input('Kumaş türü','fabric',r.fabric)}${input('Gramaj','gsm',r.gsm)}${input('Ürün kodu','code',r.code)}${input('Lot','lot',r.lot)}${input('Takviye','reinforcement',r.reinforcement)}${input('Panel','panel',r.panel)}${select('Katlama','folded',r.folded,[['','Belirtilmedi'],['yes','Katlamalı'],['no','Katlamasız']])}</div></div><div class="card"><div class="section-head"><div><h3>Üretim işçiliği</h3><p>İşlem bazında geçen süreyi, çalışan kişi sayısını ve üretilen adedi girin.</p></div><span class="pill ${labor.missing?'warn':''}">${labor.missing?'Veri eksik':fmt(labor.value)+' kişi-dk/adet'}</span></div><div class="grid cols-2">${r.method==='ready'?'<p class="warning">Eski hazır kişi-dakika girişi artık kullanılmıyor. <button type="button" class="secondary" data-action="convert-recipe">Üretim ölçümüne geç</button></p>':'<p>Hesap yöntemi: üretim ölçümü (geçen süre).</p>'}</div>${laborFormulaHelp(r.method)}<div class="section-head"><h4>İşlemler</h4><div><button data-action="add-operation" class="secondary">+ İşlem ekle</button> <button id="custom-operation" class="secondary">+ Yeni işlem adı</button></div></div>${r.operations.map((op,i)=>`<div class="subcard"><div class="section-head">${select('İşlem türü',`operations.${i}.name`,op.name,state.operationNames.map(x=>[x,x]))}<button data-action="remove-operation" data-index="${i}" class="danger ghost">Kaldır</button></div>${timeForm(`operations.${i}`,op,{batch:true})}</div>`).join('')||'<p class="muted">İşçilik işlemi eklenmedi: üretim işçiliği maliyeti 0 TL.</p>'}</div></section>`;}
function materialView(){
  const m=target('materials');if(!m)return empty('Malzeme ekleyerek başlayın.');
  const priceTL=materialPriceTL(m,state.settings),usdBase=number(m.usdBasePrice);
  const units=[['metre','Metre'],['adet','Adet'],['metrekare','Metrekare (m²)'],['kg','Kilogram (kg)']];
  const legacyUnit=!!m.unit&&!units.some(x=>x[0]===m.unit);if(legacyUnit)units.unshift([m.unit,`Eski birim: ${m.unit}`]);
  return `<section class="editor"><div class="editor-head"><div><p class="eyebrow">MALZEME KARTI</p><h1>${esc(m.name)}</h1></div><button class="danger ghost" data-action="delete" data-kind="materials">Sil</button></div><div class="card grid cols-2">${input('Girilen birim fiyat','price',m.price,'number')}${select('Giriş para birimi','currency',m.currency||'TRY',[['TRY','TL'],['EUR','Euro (EUR)'],['USD','Dolar (USD)']])}${input('Ad','name',m.name)}${input('Stok kodu','code',m.code)}${input('Kumaş türü','fabric',m.fabric||'')}${select('Birim','unit',m.unit,units)}</div><div class="card"><h3>Güncel birim fiyat · ${esc(m.unit)}</h3><p>Girilen fiyat, giriş anındaki TCMB kuruyla USD bazına alınır. Sonraki kur yenilemelerinde hesaplanan TL fiyatı bu USD tutarından güncellenir. Para birimini değiştirmeniz USD baz fiyatı değiştirmez; birim fiyatı elle düzenlerseniz yeni USD baz oluşur.</p><div class="grid cols-3 material-currency-grid"><div><small>Dolar baz fiyat</small><strong>${usdBase===null?'—':new Intl.NumberFormat('tr-TR',{style:'currency',currency:'USD',maximumFractionDigits:6}).format(usdBase)}</strong></div><div><small>Güncel TL</small><strong>${plainMoney(priceTL,'TRY',4)}</strong></div><div><small>Güncel EUR</small><strong>${plainMoney(priceTL,'EUR',4)}</strong></div></div><p class="muted">Baz alınan kur tarihi: ${esc(m.indexRateDate||'bekleniyor')} · Güncel kur tarihi: ${esc(state.settings.rateDate||'alınamadı')} · Kaynak: ${esc(state.settings.rateSource||'TCMB Döviz Satış')}.</p></div>${legacyUnit?'<p class="warning">Bu malzemenin eski birimi listede yok. Dört standart birimden birini seçin.</p>':''}${priceTL===null?'<p class="warning">USD baz fiyat veya güncel TCMB kuru eksik. Bu malzemeyi içeren set eksik verili gösterilir.</p>':''}</section>`;
}
function profileView(){const p=target('profiles');if(!p)return empty('Ambalaj profili ekleyerek başlayın.');return `<section class="editor"><div class="editor-head"><div><p class="eyebrow">AMBALAJ PROFİLİ</p><h1>${esc(p.name)}</h1></div><button class="danger ghost" data-action="delete" data-kind="profiles">Sil</button></div><div class="card"><h3>Profil ve sevkiyat</h3><div class="grid cols-4">${input('Profil adı','name',p.name)}${input('Bohça türü','bundleType',p.bundleType)}${input('Bohça ölçüsü','bundleSize',p.bundleSize)}${input('Rulo ölçüsü','rollSize',p.rollSize)}${select('Paketleme yöntemi','mode',p.mode,[['none','Yok'],['box','Koli'],['bag','Torba'],['both','Koli ve torba birlikte']])}${input('Koli başına set','setsPerBox',p.setsPerBox,'number')}${input('Torba başına set','setsPerBag',p.setsPerBag,'number')}</div></div><div class="card"><h3>Set hazırlama ve ambalaj işçiliği</h3><p>Rulo süreleri set başına, koli ve torba süreleri paket başına girilir.</p>${[['rollInsert','Rulo geçirme'],['rollClose','Rulo kapama'],['boxLabor','Koli başına'],['bagLabor','Torba başına']].map(([k,label])=>`<div class="subcard"><h4>${label}</h4>${timeForm(k,p[k])}</div>`).join('')}</div></section>`;}
function setRowLaborSummary(row,result,orderQty){
  const recipe=result.recipe;
  if(!recipe)return '<div class="line-result set-row-pending">Yarı mamul seçin; işlem ve işçilik dökümü seçimin ardından burada görünecek.</div>';
  const qty=number(row.quantity);
  const validQty=qty!==null&&qty>0;
  const validOrder=Number.isInteger(orderQty)&&orderQty>0;
  const orderUnits=validQty&&validOrder?qty*orderQty:null;
  const minuteRate=laborRates(state.settings)?.minute??null;
  const cost=minutes=>minutes===null?null:minutes===0?0:minuteRate===null?null:minutes*minuteRate;
  const productionMinutes=recipe&&!result.labor?.missing&&validQty?result.labor.value*qty:null;
  const placingMinutes=result.placing&&!result.placing.missing?result.placing.value:null;
  const totalMinutes=productionMinutes===null||placingMinutes===null?null:productionMinutes+placingMinutes;
  const orderMinutes=totalMinutes===null||!validOrder?null:totalMinutes*orderQty;
  const scopeCell=(minutes,scope,status='',note='')=>`<span>${status||`${fmt(minutes,6)} kişi-dk / ${scope}${note?`<small class="scope-note">${note}</small>`:''}${laborCurrencies(cost(minutes))}`}</span>`;
  const operationRows=recipe?.operations?.length?recipe.operations.map(op=>{
    const measured=recipe.method==='production'?personMinutes({...op,scope:'batch'}):{missing:true,value:0,applicable:true};
    const unitMinutes=measured.missing?null:measured.value;
    const setMinutes=unitMinutes===null||!validQty?null:unitMinutes*qty;
    const orderOperationMinutes=setMinutes===null||!validOrder?null:setMinutes*orderQty;
    const status=measured.missing?'Veri eksik':measured.applicable===false?'Süre girilmedi':null;
    return `<div class="set-operation-row ${detailedView?'':'order-only'}"><strong>${esc(op.name||'İsimsiz işlem')}</strong>${detailedView?`${scopeCell(unitMinutes,'adet',status)}${scopeCell(setMinutes,'set',status)}`:''}${scopeCell(orderOperationMinutes,'sipariş',status)}</div>`;
  }).join(''):'<p class="muted">Üretim işçiliği işlemi eklenmemiş: 0 kişi-dk.</p>';
  const placementStatus=!hasDuration(row.placement)?'Süre girilmedi':result.placing?.missing?'Veri eksik':'';
  const placingUnitMinutes=placingMinutes===null||!validQty?null:placingMinutes/qty;
  const placingOrderMinutes=placingMinutes===null||!validOrder?null:placingMinutes*orderQty;
  const placementNote=row.placement?.coverage==='item'?'':'Set toplamından dağıtılan pay';
  return `<div class="set-row-summary"><div class="line-result set-row-total ${detailedView?'':'order-only'}">${detailedView?`<div><small>Üretim · bir sette</small><strong>${fmt(productionMinutes,6)} kişi-dk</strong>${laborCurrencies(cost(productionMinutes))}</div><div><small>Sete dizme · bir sette</small><strong>${fmt(placingMinutes,6)} kişi-dk</strong>${laborCurrencies(cost(placingMinutes))}</div><div><small>Toplam temel işçilik · bir sette${result.missing?' · Eksik veri':''}</small><strong>${fmt(totalMinutes,6)} kişi-dk</strong>${laborCurrencies(cost(totalMinutes))}</div>`:''}<div><small>Toplam sipariş · ${validOrder?fmt(orderQty,0):'—'} set / ${orderUnits===null?'—':fmt(orderUnits,0)} adet</small><strong>${fmt(orderMinutes,6)} kişi-dk</strong>${laborCurrencies(cost(orderMinutes))}</div></div><div class="set-operation-list"><div class="set-operation-head ${detailedView?'':'order-only'}"><span>Yapılan işlem</span>${detailedView?`<span>Bir yarı mamul</span><span>Bir sette · ${validQty?fmt(qty,0):'—'} adet</span>`:''}<span>Toplam sipariş · ${orderUnits===null?'—':fmt(orderUnits,0)} adet</span></div>${operationRows}<div class="set-operation-row ${detailedView?'':'order-only'}"><strong>Sete dizme</strong>${detailedView?`${scopeCell(placingUnitMinutes,'adet',placementStatus,placementNote)}${scopeCell(placingMinutes,'set',placementStatus)}`:''}${scopeCell(placingOrderMinutes,'sipariş',placementStatus)}</div></div></div>`;
}
function setRowMaterials(row,index){
  const rows=(row.materials||[]).map((line,j)=>{
    const material=state.materials.find(x=>x.id===line.materialId);
    const price=materialPriceTL(material,state.settings),quantity=number(line.quantity);
    const unit=material?.unit||'birim seçilmedi';
    const lineCost=price!==null&&quantity!==null&&quantity>=0?price*quantity:null;
    return `<div class="subcard set-material-line"><div class="grid cols-4">
      ${select('Malzeme adı',`rows.${index}.materials.${j}.materialId`,line.materialId,[['','Malzeme seçin'],...state.materials.map(x=>[x.id,[x.name,x.fabric,x.code].filter(Boolean).join(' · ')])])}
      ${input('Boyut / ebat',`rows.${index}.materials.${j}.size`,line.size||'')}
      <div class="fabric-picker">${fabricSelect(`rows.${index}.materials.${j}.fabric`,line.fabric||'')}<button type="button" class="secondary" data-action="add-fabric-type" data-row-index="${index}" data-index="${j}">+ Kumaş türü</button></div>
      ${input(`Bir adet için miktar (${unit})`,`rows.${index}.materials.${j}.quantity`,line.quantity??'','number')}
    </div><div class="section-head"><small>${quantity!==null&&quantity>=0?`${fmt(quantity,3)} ${esc(unit)} / adet · ${money4(lineCost)} / adet`:'Bir adet için malzeme miktarını girin.'}</small><button type="button" class="danger ghost" data-action="remove-row-material" data-row-index="${index}" data-index="${j}">Kaldır</button></div></div>`;
  }).join('');
  return `<div class="set-materials"><div class="section-head"><div><h4>Bu içeriğin malzemeleri</h4><p>Her malzemenin bir adet içerik için tüketimini girin. Set maliyeti bu miktarı içerik adediyle çarpar.</p></div><button type="button" class="secondary" data-action="add-row-material" data-index="${index}">+ Malzeme ekle</button></div>${rows||'<p class="muted">Bu içerikte malzeme ataması yok; malzeme maliyeti 0 TL.</p>'}</div>`;
}
function setRowCard(set,row,index,result,orderQty){
  const recipe=result?.recipe,qty=number(row.quantity),minutes=!recipe||!result?.labor||!result?.placing||result.labor.missing||result.placing.missing||!(qty>0)?null:result.labor.value*qty+result.placing.value;
  const minuteRate=laborRates(state.settings)?.minute??null;
  const surcharge=number(state.settings.surcharge)??0;
  const laborCost=minutes===null?null:minutes===0?0:minuteRate===null?null:minutes*minuteRate*(1+surcharge/100);
  const key=set.id+':'+index;
  return `<details class="subcard set-row-compact" data-set-row="${esc(key)}" ${expandedSetRows.has(key)?'open':''}>
    <summary class="set-row-compact-head"><strong>${esc(recipe?.name||'Yeni içerik')} ${priceChangeTag(row)}</strong><span>${qty>0?fmt(qty,0):'—'} adet</span><span>İşçilik: ${money4(laborCost)}</span><span class="set-row-chevron" aria-hidden="true">⌄</span></summary>
    <div class="set-row-fields">${setRowLaborSummary(row,result,orderQty)}
      <div class="grid cols-2">${select('Yarı mamul',`rows.${index}.recipeId`,row.recipeId,[['','Seçin'],...state.recipes.map(r=>[r.id,`${r.name} · ${r.size} · ${r.fabric} · ${r.code||r.lot}`])])}${input('İçerik adedi',`rows.${index}.quantity`,row.quantity,'number')}</div>
      ${setRowMaterials(row,index)}
      <h4>Sete yerleştirme ölçümü</h4><div class="grid cols-4">${select('Ölçüm kapsamı',`rows.${index}.placement.coverage`,row.placement.coverage,[['item','Bir adet içeriği yerleştirme'],['row','Satırdaki tüm adetler'],['sets','Belirli sayıda set']])}${durationInput(`rows.${index}.placement.duration`,row.placement)}${select('Süre birimi',`rows.${index}.placement.unit`,row.placement.unit||'minute',timeUnits)}${input('Çalışan kişi sayısı',`rows.${index}.placement.people`,row.placement.people,'number')}${row.placement.coverage==='sets'?input('Ölçülen set adedi',`rows.${index}.placement.sets`,row.placement.sets,'number'):''}</div>
      <p class="muted">${row.placement.unit==='minuteSecond'?'2:35 = 2 dakika 35 saniye; saniye 00–59 olmalı.':row.placement.unit==='hour'?'0,5 saat = 30 dakika.':'2,5 dakika = 2 dakika 30 saniye.'} Geçen süre çalışan kişi sayısıyla çarpılır.</p>
      ${!hasDuration(row.placement)?'<p class="time-hint">⚠ Süre girilmedi; sete dizme işçiliği hesaba katılmıyor.</p>':''}
      ${row.placement.timeType!=='elapsed'&&hasDuration(row.placement)?`<p class="warning">Eski kişi-dakika kaydı hesaplanmaz. <button type="button" class="secondary" data-action="convert-time" data-path="rows.${index}.placement">Geçen süreye geç</button></p>`:''}
      ${hasDuration(row.placement)&&row.placement.unit==='minuteSecond'&&durationMinutes(row.placement)===null?'<p class="warning">Geçersiz süre. Örnek: 2:35; saniye 00–59 olmalı.</p>':''}
      <div class="grid cols-2">${input('Açıklama',`rows.${index}.placement.description`,row.placement.description)}${input('Ölçüm notu',`rows.${index}.placement.note`,row.placement.note)}</div>${priceChangeDetail(row,index)}
      <button type="button" data-action="remove-set-row" data-index="${index}" class="danger ghost">İçeriği kaldır</button>
    </div></details>`;
}
function setExtraLaborSummary(result,orderQty){
  const minutes=result?.duplicate?0:result?.missing?null:result?.value??null;
  const minuteRate=laborRates(state.settings)?.minute??null;
  const cost=value=>value===null?null:value===0?0:minuteRate===null?null:value*minuteRate;
  const orderMinutes=Number.isInteger(orderQty)&&orderQty>0&&minutes!==null?minutes*orderQty:null;
  return `<div class="line-result set-row-total set-extra-total"><div><small>${result?.duplicate?'Ambalaj profilinde zaten sayıldı':'Set hazırlama · bir sette'}${result?.missing?' · Veri eksik':''}</small><strong>${fmt(minutes,6)} kişi-dk</strong>${laborCurrencies(cost(minutes))}</div><div><small>Toplam sipariş · ${Number.isInteger(orderQty)&&orderQty>0?fmt(orderQty,0):'—'} set</small><strong>${fmt(orderMinutes,6)} kişi-dk</strong>${laborCurrencies(cost(orderMinutes))}</div></div>`;
}
function expenseCards(s,c){
  const items=s.otherExpenses||[];
  return `<div class="card"><h3>Kargo gideri</h3><p>Kullanılan koli sayısı = sipariş adedi ÷ koli içi adet, yukarı yuvarlanır. Son koli eksik dolsa da tam koli ücreti alınır. Toplam kargo = koli sayısı × bir koli kargo maliyeti; set başına kargo = toplam ÷ sipariş adedi.</p>${s.legacyShippingTotal!==undefined&&s.shippingBoxSize===''&&s.shippingBoxPrice===''?`<p class="warning">Eski toplam kargo kaydı: ${esc(s.legacyShippingTotal)} TL. Koli kapasitesi bilinmediği için yeni hesaba katılmadı; aşağıdaki iki alanı doldurun.</p>`:''}<div class="grid cols-2">${input('Koli içi adet (set)','shippingBoxSize',s.shippingBoxSize??'','number','ör. 10')}${input('Bir koli kargo maliyeti (TL)','shippingBoxPrice',s.shippingBoxPrice??'','number','ör. 100')}</div><div class="grid cols-3"><div class="expense-result"><small>Kullanılan koli sayısı</small><strong>${c.shippingBoxCount===null?'—':fmt(c.shippingBoxCount,0)}</strong></div><div class="expense-result"><small>Toplam kargo gideri</small><strong>${money4(c.shippingTotal)}</strong></div><div class="expense-result"><small>Set başına kargo gideri</small><strong>${money4(c.shippingPerSet)}</strong></div></div></div>
  <div class="card"><h3>Sterilizasyon gideri</h3><p>Koli başına sterilizasyon maliyetini girin. Koli sayısı, kargo bölümündeki koli içi adet ve sipariş adedinden hesaplanır. Son koli eksik dolsa da tam koli sterilizasyon gideri alınır.</p>${input('Bir koli sterilizasyon maliyeti (TL)','sterilizationPerBox',s.sterilizationPerBox??'','number','ör. 50')}<div class="grid cols-3"><div class="expense-result"><small>Sterilize edilen koli</small><strong>${c.shippingBoxCount===null?'—':fmt(c.shippingBoxCount,0)}</strong></div><div class="expense-result"><small>Toplam sterilizasyon</small><strong>${money4(c.sterilizationTotal)}</strong></div><div class="expense-result"><small>Set başına sterilizasyon</small><strong>${money4(c.sterilizationPerSet)}</strong></div></div></div>
  <div class="card"><div class="section-head"><div><h3>Diğer giderler</h3><p>Elektrik, su ve benzeri giderleri ayrı satırlar halinde ekleyin. Her satır için toplam sipariş tutarı veya set başına tutar seçin.</p></div><button type="button" class="secondary" data-action="add-other-expense">+ Gider ekle</button></div>${items.map((x,i)=>`<div class="expense-row">${input('Gider adı',`otherExpenses.${i}.name`,x.name||'')}${input('Tutar (TL)',`otherExpenses.${i}.amount`,x.amount??'','number')}${select('Hesaplama kapsamı',`otherExpenses.${i}.scope`,x.scope||'total',[['total','Sipariş toplamı'],['unit','Set başına']])}<button type="button" class="danger ghost" data-action="remove-other-expense" data-index="${i}">Kaldır</button></div>`).join('')||'<p class="muted">Diğer gider eklenmedi.</p>'}<div class="expense-result"><small>Diğer giderler · set başına</small><strong>${money4(c.otherExpensePerSet)}</strong></div></div>`;
}
function setView(){const s=target('sets');if(!s)return empty('Yeni set oluşturarak başlayın.');const c=calculateSet(s,state);const orderQty=number(s.orderQuantity??"1");const orderValid=Number.isInteger(orderQty)&&orderQty>0;const complete=!c.missing&&orderValid;if(finalizing)return finalView(s,c);return `<section class="editor"><div class="editor-head"><div><p class="eyebrow">SET MALİYETİ</p><h1>${esc(s.name)}</h1><p>Set başına maliyet ve işçilik dökümü</p></div><div class="set-head-actions"><div class="set-head-buttons"><button data-action="finalize" class="primary">Seti tamamla →</button> <div class="export-currency"><button data-action="excel-export" class="secondary" ${tutorial?'disabled title="Eğitim verileri dışa aktarılmaz"':''}>Excel'e yazdır</button><div id="currency-toggle" class="currency-toggle currency-toggle-set" aria-label="Öne çıkan para birimi"></div></div> <button class="danger ghost" data-action="delete" data-kind="sets">Sil</button></div></div></div><div class="status ${c.missing?'warn':''}">${c.status}${c.missing?' · Eksik kalemleri tamamlayın; bu tutar doğrulanmış maliyet değildir.':''}</div>${missingPanel(c,s,orderValid)}${timeWarnings(c)}${setSummaryCards(c)}<div class="card"><h3>Sipariş adedi ve kâr</h3><p>Adet, set sayısıdır. Temel maliyet malzeme, toplam işçilik, kargo, sterilizasyon ve diğer giderlerden oluşur. Hedef net kâr için vergi öncesi satış hesaplanır; seçilen vergiler bu tutara eklenir.</p><div class="grid cols-2">${input('Sipariş adedi (set)','orderQuantity',s.orderQuantity??'1','number')}${input('Hedef net kâr (%)','profitRate',s.profitRate??state.settings.profit??'0','number')}</div>${!orderValid?'<p class="warning">Sipariş adedi sıfırdan büyük tam sayı olmalı.</p>':''}${c.profitRate===null||c.profitRate<0?'<p class="warning">Hedef kâr oranı sıfır veya üzeri olmalı.</p>':''}<div class="metrics order-metrics"><div><small>Set başına toplam maliyet</small><strong>${money4(c.missing?null:c.costWithTax)}</strong></div><div><small>Set başına net kâr</small><strong>${money4(c.missing?null:c.profitAmount)}</strong></div><div><small>Toplam maliyet</small><strong>${money(complete?c.costWithTax*orderQty:null)}</strong></div><div><small>Toplam net kâr</small><strong>${money(complete?c.profitAmount*orderQty:null)}</strong></div><div><small>Toplam satış (vergiler dahil)</small><strong>${money(complete&&c.total!==null?c.total*orderQty:null)}</strong></div></div></div>${expenseCards(s,c)}<div class="card"><h3>Bu sete uygulanacak vergiler</h3><p>Vergileri burada seçin. Vergi öncesi satış = temel maliyet × (1 + hedef kâr / 100). Her vergi = vergi öncesi satış × kendi oranı / 100. Son fiyat = vergi öncesi satış + vergiler. Net kâr = son fiyat − temel maliyet − vergiler.</p>${state.taxes.length?state.taxes.map(t=>'<label class="check"><input type="checkbox" data-tax-id="'+esc(t.id)+'" '+((s.taxIds||[]).includes(t.id)?'checked':'')+'><span>'+esc(t.name)+' · %'+esc(t.rate)+'</span></label>').join(''):'<p class="muted">Henüz vergi tanımlanmadı. Ayarlar bölümünden vergi ekleyin.</p>'}<div class="breakdown"><span>Temel maliyet · malzeme + işçilik + kargo + sterilizasyon + diğer giderler</span><b>${money4(c.missing?null:c.baseTotal)}</b><span>Vergi öncesi satış fiyatı</span><b>${money4(c.missing?null:c.beforeTax)}</b>${c.taxLines.map(x=>'<span>'+esc(x.name)+' · %'+fmt(x.rate,2)+'</span><b>'+money4(c.missing?null:x.amount)+'</b>').join('')}<span>Vergi toplamı · gider</span><b>${money4(c.missing?null:c.taxAmount)}</b><span>Vergiler dahil toplam maliyet</span><b>${money4(c.missing?null:c.costWithTax)}</b><span>Net kâr · satış − maliyet</span><b>${money4(c.missing?null:c.profitAmount)}</b><span>Vergiler dahil son fiyat</span><b>${money(c.missing?null:c.total)}</b></div></div><div class="card"><h3>Set bilgileri</h3><div class="grid cols-4">${input('Set adı','name',s.name)}${input('Kod','code',s.code)}${input('Lot','lot',s.lot)}${select('Ambalaj profili','profileId',s.profileId,[['','Profil yok'],...state.profiles.map(p=>[p.id,p.name])])}</div></div><div class="card"><div class="section-head"><div><div class="content-heading"><h3>Set içeriği</h3><label class="detail-switch"><input type="checkbox" data-action="toggle-detailed-view" ${detailedView?'checked':''}><span class="detail-switch-track"></span><span>Detaylı görünüm</span></label></div><p>Üretim ve sete dizme işçiliği ayrı hesaplanır.</p></div><button data-action="add-set-row" class="secondary">+ İçerik</button></div>${s.rows.map((row,i)=>setRowCard(s,row,i,c.rows[i],orderValid?orderQty:null)).join('')||'<p class="muted">Henüz içerik yok.</p>'}</div><div class="card"><div class="section-head"><div><h3>Ek set hazırlama işlemleri</h3><p>Profilde tanımlı rulo, koli veya torba işçiliği burada tekrar sayılmaz.</p></div><button data-action="add-extra" class="secondary">+ Ek işlem</button></div>${s.extras.map((x,i)=>`<div class="subcard"><div class="section-head">${select('İşlem',`extras.${i}.name`,x.name,[['Hazırlık, taşıma ve yükleme','Hazırlık, taşıma ve yükleme'],['Rulo geçirme','Rulo geçirme'],['Rulo kapama','Rulo kapama'],['Koli işçiliği','Koli işçiliği'],['Torba işçiliği','Torba işçiliği'],...state.operationNames.map(n=>[n,n])])}<button data-action="remove-extra" data-index="${i}" class="danger ghost">Kaldır</button></div>${setExtraLaborSummary(c.extras[i],orderValid?orderQty:null)}<details class="set-row-details" data-set-row="${esc(s.id)}:extra:${i}" ${expandedSetRows.has(s.id+':extra:'+i)?'open':''}><summary>İşlem ölçümünü düzenle <span aria-hidden="true">⌄</span></summary><div class="set-row-fields">${timeForm(`extras.${i}`,x,{showSurcharge:true})}${c.extras[i]?.duplicate?'<p class="warning">Ambalaj profilinde bulunduğu için hesaba eklenmedi.</p>':''}</div></details></div>`).join('')||'<p class="muted">Ek işlem yok.</p>'}</div><div class="card"><h3>İşçilik dökümü · kişi-dakika / set</h3><div class="breakdown"><span>Yarı mamul üretimi</span><b>${fmt(c.production)}</b><span>Sete dizme</span><b>${fmt(c.placement)}</b><span>Set hazırlama ve ambalaj</span><b>${fmt(c.preparation)}</b><span>Toplam temel işçilik</span><b>${fmt(c.baseMinutes)}</b><span>Ek payı önceden içeren süre</span><b>${fmt(c.excluded)}</b><span>Ek pay uygulanacak süre</span><b>${fmt(Math.max(0,c.baseMinutes-c.excluded))}</b><span>Üretim ve set işçiliği · ek pay dahil</span><b>${money4(c.adjustedLabor)}</b><span>İdari işçilik · aynı tutar</span><b>${money4(c.administrativeLabor)}</b><span>Toplam işçilik</span><b>${money4(c.totalLabor)}</b></div>${c.packaging.parts.map(x=>`<p class="muted">${esc(x.label)}: ${fmt(x.value)} kişi-dk${x.missing?' · veri eksik':''}</p>`).join('')}</div></section>`;}
function recipeCostDetails(s,c){
  const minuteRate=laborRates(state.settings)?.minute??null;
  const surchargeRate=number(state.settings.surcharge)??0;
  let productsTotal=0,productsMissing=false;
  const items=(s.rows||[]).map((row,i)=>{
    const result=c.rows[i],recipe=result?.recipe,qty=number(row.quantity);
    const validQty=qty!==null&&qty>0;
    const title=recipe?[recipe.name,recipe.size,recipe.fabric,recipe.code||recipe.lot].filter(Boolean).join(' · '):`Satır ${i+1} · yarı mamul seçilmedi`;
    if(!recipe){productsMissing=true;return `<div class="subcard recipe-cost"><h4>${esc(title)}</h4><p class="warning">Yarı mamul seçilmedi; bu satırın maliyeti hesaplanamaz.</p></div>`;}
    const operationRows=(recipe.operations||[]).map(op=>{
      const calc=personMinutes({...op,scope:recipe.method==='production'?'batch':'unit'});
      const ready=hasDuration(op)&&!calc.missing&&recipe.method==='production';
      const unitMinutes=calc.missing?null:!hasDuration(op)?0:ready?calc.value:null;
      const setMinutes=validQty&&unitMinutes!==null?unitMinutes*qty:null;
      const unitCost=unitMinutes===null?null:unitMinutes===0?0:minuteRate===null?null:unitMinutes*minuteRate;
      const setCost=setMinutes===null?null:setMinutes===0?0:minuteRate===null?null:setMinutes*minuteRate;
      const duration=op.unit==='minuteSecond'?`${esc(op.duration)} dk:sn`:op.unit==='hour'?`${esc(op.duration)} saat`:`${esc(op.duration)} dk`;
      const formula=!hasDuration(op)?'Süre girilmedi · hesaba katılmadı':ready?
        `${duration} × ${fmt(number(op.people),3)} kişi ÷ ${fmt(number(op.output),3)} üretilen adet`:
        'Veri eksik veya geçersiz · hesaba doğrulanmış tutar eklenmedi';
      return `<tr><th scope="row">${esc(op.name||'Adsız işlem')}</th><td>${formula}</td><td>${fmt(unitMinutes,6)}</td><td>${laborCurrencies(unitCost)}</td><td>${fmt(setMinutes,6)}</td><td>${laborCurrencies(setCost)}</td></tr>`;
    }).join('');
    const productionMinutes=validQty&&result.labor&&!result.labor.missing?result.labor.value*qty:null;
    const productionCost=productionMinutes===null?null:productionMinutes===0?0:minuteRate===null?null:productionMinutes*minuteRate;
    const productionUnitMinutes=result.labor&&!result.labor.missing?result.labor.value:null;
    const productionUnitCost=productionUnitMinutes===null?null:productionUnitMinutes===0?0:minuteRate===null?null:productionUnitMinutes*minuteRate;
    const materialRows=(row.materials||[]).map(line=>{
      const material=state.materials.find(x=>x.id===line.materialId);
      const amount=number(line.quantity),price=materialPriceTL(material,state.settings);
      const valid=material&&amount!==null&&amount>=0&&price!==null&&validQty;
      const original=material?`${esc(material.price)} ${esc(material.currency||'TRY')} / ${esc(material.unit)}`:'Malzeme seçilmedi';
      return `<tr><th scope="row">${esc(material?.name||'Eksik malzeme')}<small>${esc([line.size,line.fabric].filter(Boolean).join(' · '))}</small></th><td>${valid?`${fmt(amount,3)} ${esc(material.unit)} × ${fmt(qty,3)} adet × ${money4(price)} / ${esc(material.unit)} (${original})`:'Veri eksik veya geçersiz'}</td><td>${money4(valid?amount*qty*price:null)}</td></tr>`;
    }).join('');
    const placing=result.placing,placingCost=placing&&!placing.missing?(placing.value===0?0:minuteRate===null?null:placing.value*minuteRate):null;
    const surcharge=productionCost===null||placingCost===null?null:(productionCost+placingCost)*surchargeRate/100;
    const rowMaterial=validQty&&(row.materials||[]).every(line=>{
      const material=state.materials.find(x=>x.id===line.materialId);
      const amount=number(line.quantity);
      return material&&amount!==null&&amount>=0&&materialPriceTL(material,state.settings)!==null;
    })?result.material:null;
    const rowTotal=rowMaterial===null||productionCost===null||surcharge===null||placingCost===null?null:rowMaterial+productionCost+surcharge+placingCost;
    if(rowTotal===null)productsMissing=true;else productsTotal+=rowTotal;
    const laborMinutes=productionMinutes===null||placing?.missing?null:productionMinutes+placing.value;
    const laborTotal=productionCost===null||placingCost===null||surcharge===null?null:productionCost+placingCost+surcharge;
    const laborUnit=validQty&&laborTotal!==null?laborTotal/qty:null;
    const laborUnitMinutes=validQty&&laborMinutes!==null?laborMinutes/qty:null;
    const placingFormula=placing?.missing?'Veri eksik veya geçersiz':!hasDuration(row.placement)?'Süre girilmedi · hesaba katılmadı':
      `${fmt(placing.value,6)} kişi-dk / set × ${minuteRate===null?'—':fmt(minuteRate,6)+' TL/dk'} · ${row.placement?.coverage==='item'?'bir ürün × içerik adedi':row.placement?.coverage==='row'?'satırdaki tüm adetler':`${esc(row.placement?.sets)} setlik ölçüm ÷ set sayısı`}`;
    return `<div class="subcard recipe-cost">
      <h4>${esc(title)} <span class="recipe-cost-qty">${validQty?fmt(qty,3):'—'} adet / set</span></h4>
      <p class="muted">Bir adet için kişi-dk = geçen süre × çalışan kişi sayısı ÷ üretilen adet. Set sütunları bu değeri setteki adetle çarpar. TL = kişi-dk × ${minuteRate===null?'—':fmt(minuteRate,6)} TL/dk; EUR ve USD = TL ÷ güncel TCMB kuru.</p>
      <div class="cost-table-wrap"><table class="cost-table labor-operation-table">
        <thead><tr><th>Üretim işlemi</th><th>Ölçüm hesabı</th><th>Kişi-dk / adet</th><th>İşçilik / adet</th><th>Kişi-dk / set</th><th>İşçilik / set</th></tr></thead>
        <tbody>${operationRows||'<tr><td colspan="6">Üretim işlemi eklenmemiş; üretim işçiliği 0 TL.</td></tr>'}</tbody>
      </table></div>
      <div class="labor-summary-grid">
        <div><small>Üretim toplamı · bir adet</small><strong>${fmt(productionUnitMinutes,6)} kişi-dk</strong>${laborCurrencies(productionUnitCost)}</div>
        <div><small>Üretim toplamı · sette ${validQty?fmt(qty,3):'—'} adet</small><strong>${fmt(productionMinutes,6)} kişi-dk</strong>${laborCurrencies(productionCost)}</div>
      </div>
      <h5>Malzeme ve sete dizme</h5>
      <div class="cost-table-wrap"><table class="cost-table"><thead><tr><th>Kalem</th><th>Hesap</th><th>Sette tutar</th></tr></thead><tbody>${materialRows||'<tr><td colspan="3">Malzeme eklenmemiş.</td></tr>'}<tr><th scope="row">Sete dizme</th><td>${placingFormula}</td><td>${laborCurrencies(placingCost)}</td></tr></tbody></table></div>
      <div class="breakdown"><span>Bu ürünün üretim ve dizme işçiliği ek payı · %${fmt(surchargeRate,2)}</span>${laborCurrencies(surcharge)}</div>
      <div class="labor-summary-grid">
        <div><small>Toplam işçilik · bir adede düşen pay</small><strong>${fmt(laborUnitMinutes,6)} kişi-dk</strong>${laborCurrencies(laborUnit)}</div>
        <div><small>Toplam işçilik · sette ${validQty?fmt(qty,3):'—'} adet</small><strong>${fmt(laborMinutes,6)} kişi-dk</strong>${laborCurrencies(laborTotal)}</div>
      </div>
      <div class="breakdown recipe-cost-total"><span>Bu ürünün set maliyeti · malzeme + üretim + dizme + ek pay</span><b>${money4(rowTotal)}</b></div>
      ${rowTotal===null?'<p class="warning">Bu ürünün maliyetinde eksik veri var; toplam doğrulanmış fiyat değildir.</p>':''}
    </div>`;
  }).join('');
  const excludedExtra=(c.extras||[]).reduce((total,x)=>total+(!x.duplicate&&x.item?.surchargeIncluded?x.value:0),0);
  const commonBase=c.preparation===0?0:minuteRate===null?null:c.preparation*minuteRate;
  const commonSurcharge=commonBase===null?null:(c.preparation-excludedExtra)*minuteRate*surchargeRate/100;
  const sharedRows=[...c.packaging.parts.map(x=>({name:x.label,value:x.value,missing:x.missing})),...c.extras.filter(x=>!x.duplicate).map(x=>({name:x.item.name,value:x.value,missing:x.missing}))];
  const sharedTable=sharedRows.map(x=>`<tr><th scope="row">${esc(x.name)}</th><td>${x.missing?'Veri eksik':`${fmt(x.value,6)} kişi-dk / set × ${minuteRate===null?'—':fmt(minuteRate,6)+' TL/dk'}`}</td><td>${laborCurrencies(x.missing?null:x.value===0?0:minuteRate===null?null:x.value*minuteRate)}</td></tr>`).join('');
  return `<div class="card"><h3>Yarı mamul bazında ayrıntılı maliyet</h3><p>Her ürün için işlem ölçümü, setteki miktar, kişi-dakika ve TL/EUR/USD işçilik karşılığı ayrı gösterilir. Ortak ambalaj ve set hazırlama giderleri ayrıca eklenir.</p>${items||'<p class="muted">Set içeriği eklenmemiş.</p>'}<div class="subcard recipe-cost"><h4>Ortak set hazırlama ve ambalaj</h4><div class="cost-table-wrap"><table class="cost-table"><thead><tr><th>İşlem</th><th>Hesap</th><th>Sette tutar</th></tr></thead><tbody>${sharedTable||'<tr><td colspan="3">Ortak işlem yok.</td></tr>'}</tbody></table></div><div class="breakdown"><span>Ortak işlem işçiliği</span>${laborCurrencies(commonBase)}<span>Ortak işçilik ek payı · %${fmt(surchargeRate,2)}${excludedExtra>0?' · önceden ek pay içeren süre hariç':''}</span>${laborCurrencies(commonSurcharge)}</div></div><div class="breakdown recipe-cost-total"><span>Ürünler toplamı</span><b>${money4(productsMissing?null:productsTotal)}</b><span>Ortak işlemler + ek pay</span><b>${money4(commonBase===null||commonSurcharge===null?null:commonBase+commonSurcharge)}</b><span>İdari işçilik · doğrudan işçilik kadar</span><b>${money4(c.administrativeLabor)}</b><span>Kargo · set başına</span><b>${money4(c.shippingPerSet)}</b><span>Sterilizasyon · set başına</span><b>${money4(c.sterilizationPerSet)}</b><span>Diğer giderler · set başına</span><b>${money4(c.otherExpensePerSet)}</b><span>Set temel maliyeti · vergi ve kâr öncesi</span><b>${money4(c.missing?null:c.baseTotal)}</b></div></div>`;
}
function laborOverview(c){
  const minuteRate=laborRates(state.settings)?.minute??null;
  const entry=(label,minutes,amount)=>`<div><small>${label}</small><strong>${minutes===null?'Parasal tutar':`${fmt(minutes,6)} kişi-dk / set`}</strong>${laborCurrencies(amount)}</div>`;
  const amount=minutes=>minutes===0?0:minuteRate===null?null:minutes*minuteRate;
  return `<div class="card"><h3>İşçilik dökümü · kişi-dakika ve para karşılıkları</h3><p>TL tutarı kişi-dakika × dakikalık kişi maliyetidir. EUR ve USD karşılıkları güncel kurla yalnızca gösterim için hesaplanır; maliyet hesabı TL üzerinden sürer.</p><div class="labor-overview-grid">${entry('Yarı mamul üretimi',c.production,amount(c.production))}${entry('Sete dizme',c.placement,amount(c.placement))}${entry('Set hazırlama ve ambalaj',c.preparation,amount(c.preparation))}${entry('İşçilik ek payı',null,c.supplement)}${entry('Üretim ve set işçiliği · ek pay dahil',c.baseMinutes,c.adjustedLabor)}${entry('İdari işçilik · eşit tutar',null,c.administrativeLabor)}${entry('Toplam işçilik',null,c.totalLabor)}</div><p class="muted">${state.settings.ratesVerified?`${esc(state.settings.rateSource||'TCMB Döviz Satış')} · kur tarihi: ${esc(state.settings.rateDate)}`:'Kur alınamadı; EUR ve USD tutarları gösterilemiyor.'}${c.missing?' · Eksik verili hesap; ara tutarlar kesin maliyet değildir.':''}</p></div>`;
}
function finalView(s,c){
  const orderQty=number(s.orderQuantity??"1");
  const orderValid=Number.isInteger(orderQty)&&orderQty>0;
  const complete=!c.missing&&orderValid;
  return `<section class="editor narrow"><div class="editor-head"><div><p class="eyebrow">SETİ TAMAMLA</p><h1>${esc(s.name)}</h1><p>Son fiyatlandırma dökümü</p></div><button data-action="finalize-back" class="secondary">← Sete dön</button></div><div class="status ${c.missing?'warn':''}">${c.status}${c.missing?' · Eksik maliyet kalemleri varsa sonuç kesin fiyat değildir.':''}</div>${missingPanel(c,s,orderValid)}${timeWarnings(c)}<div class="card"><h3>Bu sete uygulanacak vergiler</h3><p>Vergileri bu setin önceki ekranında seçtiniz. Vergi öncesi satışa eklenen tutarlar maliyet dökümünde gider olarak ayrı gösterilir. Net kâr = son satış fiyatı − (malzeme + toplam işçilik + kargo + sterilizasyon + diğer giderler + vergiler).</p><p class="muted">Seçilen vergiler: ${c.taxLines.length?c.taxLines.map(x=>esc(x.name)+" (%"+fmt(x.rate,2)+")").join(", "):"Yok"} · <button data-action="finalize-back" class="secondary">Vergi seçimini değiştir</button></p><div class="breakdown"><span>Malzeme maliyeti</span><b>${money4(c.materials)}</b><span>Temel işçilik</span><b>${money4(c.baseLabor)}</b><span>İşçilik ek payı</span><b>${money4(c.supplement)}</b><span>Üretim ve set işçiliği · ek pay dahil</span><b>${money4(c.adjustedLabor)}</b><span>İdari işçilik · aynı tutar</span><b>${money4(c.administrativeLabor)}</b><span>Toplam işçilik</span><b>${money4(c.totalLabor)}</b><span>Kargo · set başına</span><b>${money4(c.shippingPerSet)}</b><span>Sterilizasyon · set başına</span><b>${money4(c.sterilizationPerSet)}</b><span>Diğer giderler · set başına</span><b>${money4(c.otherExpensePerSet)}</b><span>Vergi öncesi satış fiyatı</span><b>${money4(c.beforeTax)}</b>${c.taxLines.map(x=>`<span>${esc(x.name)} · %${fmt(x.rate,2)}</span><b>${money4(x.amount)}</b>`).join('')}<span>Vergi toplamı · gider</span><b>${money4(c.taxAmount)}</b><span>Temel maliyet · malzeme + işçilik + kargo + sterilizasyon + diğer giderler</span><b>${money4(c.baseTotal)}</b><span>Vergiler dahil toplam maliyet</span><b>${money4(c.costWithTax)}</b><span>Net kâr · satış − maliyet</span><b>${money4(c.profitAmount)}</b><span>Son fiyat</span><b>${money(c.total)}</b></div>${c.taxAmount===null?'<p class="warning">Seçili vergilerden birinin oranı eksik veya geçersiz.</p>':''}<div class="subcard"><h3>Sipariş toplamları · ${orderValid?orderQty:'—'} set</h3><div class="breakdown"><span>Temel maliyet × adet</span><b>${money(complete?c.baseTotal*orderQty:null)}</b><span>Vergi gideri × adet</span><b>${money(complete?c.taxAmount*orderQty:null)}</b><span>Toplam maliyet · temel + vergi</span><b>${money(complete?c.costWithTax*orderQty:null)}</b><span>Toplam net kâr</span><b>${money(complete?c.profitAmount*orderQty:null)}</b><span>Toplam satış</span><b>${money(complete?c.total*orderQty:null)}</b></div></div><div class="subcard"><div class="section-head"><h3>Son fiyatın döviz karşılığı</h3><button data-action="refresh-rates" class="secondary" ${rateLoading?'disabled':''}>${rateLoading?'Güncelleniyor…':'Kurları güncelle'}</button></div><div class="grid cols-2"><div><small>Euro (EUR)</small><strong>${foreignMoney(c.missing?null:c.total,'EUR')}</strong></div><div><small>Dolar (USD)</small><strong>${foreignMoney(c.missing?null:c.total,'USD')}</strong></div></div><p class="muted">${esc(state.settings.rateSource||'TCMB Döviz Satış')} · Veri tarihi: ${state.settings.ratesVerified?esc(state.settings.rateDate):'kur alınamadı'} · TL son fiyat ÷ ilgili kur. Bunlar gösterge niteliğindeki karşılıklardır.</p>${rateError?'<p class="warning">'+esc(rateError)+'</p>':''}</div></div>${laborOverview(c)}${recipeCostDetails(s,c)}</section>`;
}
function settingsView(){
  const rates=laborRates(state.settings);
  const rateText=(value,digits)=>value===null?'—':`${fmt(value,digits)} TL`;
  const fx=state.settings.ratesVerified===true;
  return `<section class="editor narrow"><p class="eyebrow">HESAPLAMA AYARLARI</p><h1>Fiyatlandırma</h1><p class="lead">Aylık maaş ve çalışma saatinden kişi ücretleri hesaplanır. TCMB kurları internetten alınır; vergiler listede tanımlanır.</p><div class="card"><h3>İşçilik ve kâr</h3><div class="grid cols-2">${input('Aylık maaş (TL)','monthlySalary',state.settings.monthlySalary??'','number')}${input('Aylık çalışma saati','monthlyHours',state.settings.monthlyHours??'','number')}${input('İşçilik ek payı (%)','surcharge',state.settings.surcharge,'number')}${input('Yeni setler için varsayılan kâr (%)','profit',state.settings.profit,'number')}</div><p class="muted">Saatlik ücret = aylık maaş ÷ aylık çalışma saati. Dakikalık ve saniyelik ücret buradan hesaplanır. Varsayılan kâr, yeni set oluşturulurken kopyalanır; her sette ayrıca değiştirilebilir.</p><div class="metrics rate-metrics"><div><small>Saatlik kişi maliyeti</small><strong>${rateText(rates?.hour??null,4)}</strong></div><div><small>Dakikalık kişi maliyeti</small><strong>${rateText(rates?.minute??null,4)}</strong></div><div><small>Saniyelik kişi maliyeti</small><strong>${rateText(rates?.second??null,6)}</strong></div></div>${!rates?'<p class="warning">İşçilik maliyeti için geçerli bir aylık maaş ve sıfırdan büyük çalışma saati girin.</p>':''}</div><div class="card"><h3>TCMB döviz kurları</h3><p>Malzeme dönüşümünde Türkiye Cumhuriyet Merkez Bankasının gösterge niteliğindeki <b>Döviz Satış</b> kuru kullanılır. Kurlar uygulama açıldığında internetten alınır; elle girilmez.</p><div class="grid cols-2"><div><small>1 EUR / TL</small><strong>${fx?fmt(number(state.settings.eurTry),4):'—'}</strong></div><div><small>1 USD / TL</small><strong>${fx?fmt(number(state.settings.usdTry),4):'—'}</strong></div></div><p class="muted">Kur veri tarihi: ${fx?esc(state.settings.rateDate):'—'} · Kaynak: ${esc(state.settings.rateSource||'TCMB Döviz Satış')} · ${rateLoading?'Yükleniyor':fx?'Bu oturumda alındı':'Kur alınamadı'}.</p>${rateError?`<p class="warning">${esc(rateError)} Dövizli malzemeler eksik verili sayılır.</p>`:''}<button data-action="refresh-rates" class="secondary" ${rateLoading?'disabled':''}>Kurları yenile</button></div><div class="card"><div class="section-head"><div><h3>Vergi listesi</h3><p>Vergi adı ve oranını burada tanımlayın. Vergileri set ekranında seçin; tutarları son fiyatlandırma ekranında görün.</p></div><button data-action="add-tax" class="secondary">+ Vergi ekle</button></div>${state.taxes.map((t,i)=>`<div class="inline-row">${input('Vergi adı',`taxes.${i}.name`,t.name)}${input('Oran (%)',`taxes.${i}.rate`,t.rate,'number')}<button data-action="remove-tax" data-index="${i}" class="danger ghost">Sil</button></div>`).join('')||'<p class="muted">Henüz vergi yok.</p>'}</div><div class="card"><h3>Verileriniz</h3><p>Kayıtlar bu uygulamanın yerel depolamasında saklanır. Referans Excel otomatik aktarılmaz.</p><button data-action="export" class="secondary">JSON dışa aktar</button> <label class="secondary file-button">JSON içe aktar<input id="import" type="file" accept="application/json,.json" hidden></label></div></section>`;
}
function empty(message){return `<section class="empty"><div class="empty-icon">✳</div><h2>Buradan başlayın</h2><p>${message}</p></section>`;}
function startTutorial(){
  if(tutorial)return;
  finalizing=false;
  tutorial={index:0,realState:state,originalTab:tab,originalSelected:{...selected}};
  state=tutorialState(tutorial.realState.settings);
  indexAllMaterials(state);
  selected={sets:'tutorial-set-1',recipes:'tutorial-recipe-1',profiles:'tutorial-profile-1',materials:'tutorial-material-1'};
  goTutorial(0);
}
function endTutorial(){
  if(!tutorial)return;
  state=tutorial.realState;tab=tutorial.originalTab;selected=tutorial.originalSelected;tutorial=null;finalizing=false;
  save();render();
}
function goTutorial(index){
  if(!tutorial)return;
  finalizing=false;
  tutorial.index=Math.max(0,Math.min(tutorialSteps.length-1,index));
  const step=tutorialSteps[tutorial.index];tab=step.tab;
  if(step.prepare==='sampleSet')selected.sets='tutorial-set-1';
  if(step.prepare==='productionOperation'){
    const r=target('recipes');
    if(r){r.method='production';if(!r.operations.length)r.operations.push({name:state.operationNames[0],...emptyTime('batch')});r.operations[0].timeType='elapsed';}
  }
  if(step.prepare==='readyTotal'){
    const r=target('recipes');
    if(r){r.method='ready';r.readySource='total';if(r.readyTotal.status!=='known'){r.readyTotal={...emptyTime(),status:'known',duration:'1,287'};}}
  }
  if(step.prepare==='setRow'){
    const s=target('sets');
    if(s&&!s.rows.length)s.rows.push({recipeId:'tutorial-recipe-1',quantity:'1',materials:[],placement:{...emptyTime(),status:'known',duration:'5,5',coverage:'sets',sets:'100'}});
    if(s)expandedSetRows.add(s.id+':0');
  }
  render();
}
function renderTutorial(){
  const help=$('#help-button'),label=$('#tutorial-mode-label');
  const exportButton=document.querySelector('[data-action="export"]'),importInput=$('#import');
  if(exportButton)exportButton.disabled=!!tutorial;
  if(importInput)importInput.disabled=!!tutorial;
  document.querySelector('.file-button')?.classList.toggle('tutorial-disabled',!!tutorial);
  help.dataset.action=tutorial?'tutorial-exit':'tutorial-start';
  help.textContent=tutorial?'×':'?';
  help.setAttribute('aria-label',tutorial?'Eğitimi kapat':'Etkileşimli eğitimi aç');
  help.title=tutorial?'Eğitimi kapat':'Etkileşimli eğitim';
  label.hidden=!tutorial;
  document.querySelectorAll('.tutorial-highlight').forEach(el=>el.classList.remove('tutorial-highlight'));
  let panel=$('#tutorial-panel');
  let marker=$('#tutorial-pointer');
  if(!tutorial){panel?.remove();marker?.remove();return;}
  if(!panel){panel=document.createElement('aside');panel.id='tutorial-panel';panel.setAttribute('aria-label','Etkileşimli eğitim');document.body.append(panel);}
  if(!marker){marker=document.createElement('div');marker.id='tutorial-pointer';marker.setAttribute('aria-hidden','true');marker.textContent='➜';document.body.append(marker);}
  const step=tutorialSteps[tutorial.index];
  panel.innerHTML=`<div class="tour-top"><span class="tour-badge">EĞİTİM · KAYDEDİLMİYOR</span><button data-action="tutorial-exit" aria-label="Eğitimi kapat">×</button></div><div class="tour-progress"><span style="width:${(tutorial.index+1)/tutorialSteps.length*100}%"></span></div><label class="tour-jump-label">Konuya git<select id="tutorial-jump">${tutorialSteps.map((s,i)=>`<option value="${i}" ${i===tutorial.index?'selected':''}>${i+1}. ${esc(s.title)}</option>`).join('')}</select></label><h2>${esc(step.title)}</h2><p>${esc(step.text)}</p><div class="tour-tip"><strong>Deneyin</strong><span>${esc(step.tip)}</span></div><div class="tour-actions"><button class="secondary" data-action="tutorial-prev" ${tutorial.index===0?'disabled':''}>← Önceki</button><span>${tutorial.index+1} / ${tutorialSteps.length}</span><button class="primary" data-action="tutorial-next">${tutorial.index===tutorialSteps.length-1?'Eğitimi bitir':'Sonraki →'}</button></div>`;
  requestAnimationFrame(()=>{
    if(!tutorial)return;
    const targetEl=document.querySelector(step.target)||document.querySelector('[data-action="add"]');
    if(!targetEl){marker.hidden=true;return;}
    targetEl.classList.add('tutorial-highlight');
    const before=targetEl.getBoundingClientRect();
    const scrolled=before.top<90||before.bottom>window.innerHeight-30;
    if(scrolled)targetEl.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    const positionMarker=()=>{
      if(!targetEl.isConnected||!tutorial)return;
      const rect=targetEl.getBoundingClientRect();
      marker.hidden=false;
      marker.style.left=`${Math.max(6,Math.min(rect.left-18,window.innerWidth-40))}px`;
      marker.style.top=`${Math.max(6,Math.min(rect.top-18,window.innerHeight-40))}px`;
      panel.classList.toggle('tour-left',rect.right>window.innerWidth-390&&rect.bottom>window.innerHeight-330);
    };
    positionMarker();
    if(scrolled)setTimeout(positionMarker,320);
  });
}
function render(){
  renderVersion++;
  const viewKey=`${tab}:${selected[tab]||''}:${finalizing?'final':'edit'}`;
  const previousViewKey=lastRenderedViewKey;
  const viewChanged=viewKey!==previousViewKey;
  lastRenderedViewKey=viewKey;
  for(const el of document.querySelectorAll('details[data-set-row]')){
    if(el.open)expandedSetRows.add(el.dataset.setRow);
    else expandedSetRows.delete(el.dataset.setRow);
  }
  capturePriceSnapshots();nav();$('#app').classList.toggle('sidebar-collapsed',sidebarCollapsed);$('#app').innerHTML=tab==='settings'?settingsView():`${sidebar(tab,{sets:'Setler',recipes:'Yarı mamuller',materials:'Malzemeler',profiles:'Ambalaj profilleri'}[tab],`${state[tab].length} kayıt`)}${{sets:setView,recipes:recipeView,materials:materialView,profiles:profileView}[tab]()}`;
  const sidebarContent=document.querySelector('.sidebar-content');if(sidebarContent)sidebarContent.inert=sidebarCollapsed;
  if(viewChanged){document.querySelector('.editor')?.classList.add('page-enter');if(previousViewKey&&!tutorial&&window.scrollY>0)window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
  if(detailViewChanged){document.querySelectorAll('.set-row-summary').forEach(el=>el.classList.add('detail-swap'));detailViewChanged=false;}
  renderCurrencyToggle();renderTutorial();
}
function appDialog({title,message='',inputLabel='',confirmLabel='Tamam',danger=false,onConfirm=()=>{}}){
  document.querySelector('#app-dialog')?.remove();
  const previousFocus=document.activeElement;
  const overlay=document.createElement('div');
  overlay.id='app-dialog';overlay.className='app-dialog-backdrop';
  overlay.innerHTML=`<form class="app-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${message?`<p>${esc(message)}</p>`:''}${inputLabel?`<label class="field"><span>${esc(inputLabel)}</span><input name="dialogValue" required autocomplete="off"></label>`:''}<div class="app-dialog-actions"><button type="button" class="secondary" data-dialog-cancel>Vazgeç</button><button type="submit" class="${danger?'danger':'primary'}">${esc(confirmLabel)}</button></div></form>`;
  const close=restore=>{overlay.remove();if(restore&&previousFocus?.isConnected)previousFocus.focus();};
  overlay.querySelector('[data-dialog-cancel]').addEventListener('click',()=>close(true));
  overlay.addEventListener('click',e=>{if(e.target===overlay)close(true);});
  overlay.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close(true);}});
  overlay.querySelector('form').addEventListener('submit',e=>{
    e.preventDefault();
    const value=overlay.querySelector('[name="dialogValue"]')?.value.trim()??'';
    close(false);onConfirm(value);
  });
  document.body.append(overlay);
  (overlay.querySelector('input')||overlay.querySelector('[type="submit"]')).focus();
}
function addCustomOperation(){
  appDialog({title:'Yeni işlem adı',inputLabel:'İşlem adı',confirmLabel:'İşlemi ekle',onConfirm:name=>{
    const recipe=target('recipes');if(!name||!recipe)return;
    if(!state.operationNames.includes(name))state.operationNames.push(name);
    recipe.operations.push({name,...emptyTime('batch')});save();render();
  }});
}
function showAppNotice(message){
  document.querySelector('#app-notice')?.remove();
  const notice=document.createElement('div');notice.id='app-notice';notice.className='app-notice';
  notice.innerHTML=`<span>${esc(message)}</span><button type="button" aria-label="Bildirimi kapat">×</button>`;
  notice.querySelector('button').addEventListener('click',()=>notice.remove());
  document.body.append(notice);
}
function renderPreservingFocus(){
  const active=document.activeElement;
  const path=active?.dataset?.path,id=active?.id,taxId=active?.dataset?.taxId,action=active?.dataset?.action,tabKey=active?.dataset?.tab;
  const detailKey=active?.matches?.('summary')?active.closest('details[data-set-row]')?.dataset?.setRow:null;
  const start=active instanceof HTMLInputElement&&['text','search','tel','url','password'].includes(active.type)?active.selectionStart:null;
  const end=start===null?null:active.selectionEnd;
  render();
  const next=path?[...document.querySelectorAll('[data-path]')].find(el=>el.dataset.path===path):
    taxId?[...document.querySelectorAll('[data-tax-id]')].find(el=>el.dataset.taxId===taxId):
    tabKey?[...document.querySelectorAll('[data-tab]')].find(el=>el.dataset.tab===tabKey):
    action?[...document.querySelectorAll('[data-action]')].find(el=>el.dataset.action===action):
    detailKey?[...document.querySelectorAll('details[data-set-row]')].find(el=>el.dataset.setRow===detailKey)?.querySelector('summary'):
    id?document.getElementById(id):null;
  if(next){next.focus({preventScroll:true});if(start!==null&&end!==null&&next.setSelectionRange)next.setSelectionRange(start,end);}
}
function scheduleChangeRender(){
  if(pointerPressActive){pendingChangeRender=true;pendingRenderVersion=renderVersion;return;}
  const version=renderVersion;
  setTimeout(()=>{if(renderVersion===version)renderPreservingFocus();},0);
}
document.addEventListener('pointerdown',()=>{pointerPressActive=true;},true);
document.addEventListener('pointerup',()=>{
  setTimeout(()=>{if(pendingChangeRender){pendingChangeRender=false;pointerPressActive=false;if(renderVersion===pendingRenderVersion)renderPreservingFocus();}},0);
},true);
document.addEventListener('pointercancel',()=>{pointerPressActive=false;pendingChangeRender=false;},true);
function setPath(obj,path,value){const keys=path.split('.');let p=obj;for(const k of keys.slice(0,-1))p=p[k];p[keys.at(-1)]=value;}
function getPath(obj,path){return path.split('.').reduce((value,key)=>value?.[key],obj);}
document.addEventListener('click',e=>{
  const summary=e.target.closest('summary');
  const details=summary?.parentElement;
  if(!details?.matches('details[data-set-row]'))return;
  e.preventDefault();
  if(details.dataset.motionBusy)return;
  const panel=details.querySelector(':scope > .set-row-fields');
  if(!panel||matchMedia('(prefers-reduced-motion: reduce)').matches){details.open=!details.open;return;}
  details.dataset.motionBusy='true';
  const closing=details.open;
  const fromHeight=details.getBoundingClientRect().height;
  if(!closing)panel.style.opacity='0';
  details.open=!closing;
  const toHeight=details.getBoundingClientRect().height;
  if(closing)details.open=true;
  details.style.height=`${fromHeight}px`;
  details.style.overflow='hidden';
  const animation=details.animate([{height:`${fromHeight}px`},{height:`${toHeight}px`}],
    {duration:420,easing:'cubic-bezier(.4,0,.2,1)'});
  const contentAnimation=closing?null:panel.animate(
    [{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],
    {duration:320,delay:60,easing:'ease-out',fill:'forwards'});
  const finish=()=>{if(closing)details.open=false;details.style.height='';details.style.overflow='';panel.style.opacity='';contentAnimation?.cancel();delete details.dataset.motionBusy;};
  animation.onfinish=finish;
  animation.oncancel=finish;
},true);
document.addEventListener('change',e=>{if(e.target.dataset.action==='toggle-detailed-view'){detailedView=e.target.checked;detailViewChanged=true;render();return;}if(e.target.id==='tutorial-jump'){goTutorial(Number(e.target.value));return;}if(e.target.id==='import'){if(tutorial){e.target.value='';return;}const f=e.target.files[0];if(!f)return;f.text().then(t=>{try{const data=JSON.parse(t);if(!data.settings||!Array.isArray(data.recipes)||!Array.isArray(data.sets)||!Array.isArray(data.materials)||!Array.isArray(data.profiles))throw Error('Geçersiz yedek');state=normalizeState(data);selected={sets:state.sets[0]?.id,recipes:state.recipes[0]?.id,materials:state.materials[0]?.id,profiles:state.profiles[0]?.id};save();render();refreshRates();}catch(err){showAppNotice(err.message)}});return;}const taxId=e.target.dataset.taxId;
if(taxId&&tab==='sets'){
  const set=target('sets');set.taxIds ||= [];
  set.taxIds=e.target.checked?[...new Set([...set.taxIds,taxId])]:set.taxIds.filter(x=>x!==taxId);
  save();scheduleChangeRender();return;
}
const path=e.target.dataset.path;if(!path)return;const obj=tab==='settings'&&path.startsWith('taxes.')?state:tab==='settings'?state.settings:target(tab);if(!obj)return;
if(tab==='materials'&&path==='currency'){
  if(!indexMaterialPrice(obj,state.settings)||state.settings.ratesVerified!==true){showAppNotice('Para birimini değiştirmek için önce TCMB kurlarını yenileyin.');render();return;}
  const base=number(obj.usdBasePrice),usd=number(state.settings.usdTry),eur=number(state.settings.eurTry);
  const converted=e.target.value==='USD'?base:e.target.value==='TRY'?base*usd:base*usd/eur;
  if(!Number.isFinite(converted)){showAppNotice('Seçilen para biriminin kuru alınamadı.');render();return;}
  obj.currency=e.target.value;obj.price=String(Math.round(converted*1e6)/1e6);
 }else{
   setPath(obj,path,e.target.type==='checkbox'?e.target.checked:e.target.value);
   if(tab==='materials'&&path==='price')indexMaterialPrice(obj,state.settings,{force:true});
   if(tab==='sets'&&/^rows\.\d+\.recipeId$/.test(path)){
     const row=obj.rows[Number(path.split('.')[1])],recipe=state.recipes.find(x=>x.id===row.recipeId);
     row.materials=(recipe?.materials||[]).map(line=>({...line,size:recipe.size||'',fabric:recipe.fabric||''}));
     delete row.priceSnapshot;
   }
   if(tab==='sets'&&/^rows\.\d+\.materials\.\d+\.materialId$/.test(path)){
     const line=getPath(obj,path.replace(/\.materialId$/,'')),material=state.materials.find(x=>x.id===line.materialId);
     if(material?.fabric&&!line.fabric)line.fabric=material.fabric;
   }
 }
save();scheduleChangeRender();});
document.addEventListener('input',e=>{if(e.target.id!=='search')return;const q=e.target.value.toLocaleLowerCase('tr');document.querySelectorAll('.record').forEach(el=>el.hidden=!el.textContent.toLocaleLowerCase('tr').includes(q));});
document.addEventListener('click',e=>{const button=e.target.closest('[data-select-search-toggle]');if(!button)return;e.stopImmediatePropagation();const input=button.closest('.field').querySelector('[data-select-search]');input.hidden=!input.hidden;if(!input.hidden)input.focus();else{input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));}},true);
document.addEventListener('input',e=>{
  if(!e.target.matches('[data-select-search]'))return;
  const select=e.target.closest('.field').querySelector('select');
  select._allOptions ||= [...select.options].map(option=>({value:option.value,text:option.textContent}));
  const current=select.value,query=e.target.value.toLocaleLowerCase('tr').trim();
  select.replaceChildren(...select._allOptions.filter(option=>!query||option.value===current||option.text.toLocaleLowerCase('tr').includes(query)).map(option=>new Option(option.text,option.value)));
  select.value=current;
});
document.addEventListener('click',e=>{const button=e.target.closest('[data-action="display-currency"]');if(!button)return;e.stopImmediatePropagation();state.settings.displayCurrency=button.dataset.currency;save();render();},true);
document.addEventListener('click',e=>{const button=e.target.closest('[data-action="add-fabric-type"]');if(!button)return;e.stopImmediatePropagation();const rowIndex=Number(button.dataset.rowIndex),lineIndex=Number(button.dataset.index);appDialog({title:'Kumaş türü ekle',inputLabel:'Kumaş türü adı',confirmLabel:'Ekle',onConfirm:name=>{if(!name)return;const line=target('sets')?.rows?.[rowIndex]?.materials?.[lineIndex];if(!line)return;line.fabric=name;if(!state.fabricTypes.includes(name))state.fabricTypes.push(name);save();render();}});},true);
document.addEventListener('click',e=>{const b=e.target.closest('[data-action],[data-tab]');if(!b)return;const action=b.dataset.action;if(action==='toggle-detailed-view')return;if(action==='toggle-sidebar'){sidebarCollapsed=!sidebarCollapsed;$('#app').classList.toggle('sidebar-collapsed',sidebarCollapsed);const content=b.closest('.sidebar')?.querySelector('.sidebar-content');if(content)content.inert=sidebarCollapsed;b.setAttribute('aria-expanded',String(!sidebarCollapsed));b.setAttribute('aria-label',sidebarCollapsed?'Sol listeyi aç':'Sol listeyi daralt');b.title=sidebarCollapsed?'Listeyi aç':'Listeyi daralt';b.textContent=sidebarCollapsed?'☰':'‹';return;}if(action==='tutorial-start'){startTutorial();return;}if(action==='tutorial-exit'){endTutorial();return;}if(action==='tutorial-next'){tutorial.index===tutorialSteps.length-1?endTutorial():goTutorial(tutorial.index+1);return;}if(action==='tutorial-prev'){goTutorial(tutorial.index-1);return;}if(b.dataset.tab){tab=b.dataset.tab;finalizing=false;render();return;}if(action==='finalize'){finalizing=true;render();return;}if(action==='finalize-back'){finalizing=false;render();return;}if(action==='refresh-rates'){refreshRates();return;}if(action==='fix-missing'){tab=b.dataset.fixTab;selected[tab]=b.dataset.fixId||selected[tab];finalizing=false;render();const path=b.dataset.fixPath;const field=path?[...document.querySelectorAll('[data-path]')].find(el=>el.dataset.path===path):null;field?.closest('details[data-set-row]')?.setAttribute('open','');(field||document.querySelector('.editor'))?.scrollIntoView({block:'center',behavior:'smooth'});field?.focus();return;}if(action==='convert-recipe'){const recipe=target('recipes');recipe.method='production';save();render();return;}if(action==='convert-time'){const item=getPath(target(tab),b.dataset.path);if(item){item.timeType='elapsed';item.status='missing';item.duration='';item.people='';if(tab==='recipes')item.output='';save();render();}return;}if(action==='accept-price'){const row=target('sets')?.rows?.[Number(b.dataset.index)];const snapshot=setRowUnitCosts(row,state);if(row&&snapshot){row.priceSnapshot=snapshot;save();render();}return;}if(action==='excel-export'){if(tutorial||!target('sets'))return;exportSetXlsx(target('sets')).catch(err=>showAppNotice(`Excel raporu oluşturulamadı: ${err.message}`));return;}const kind=b.dataset.kind;let obj=target(tab),i=Number(b.dataset.index);if(action==='select'){selected[kind]=b.dataset.id;finalizing=false;render();return;}if(action==='add'){const v=kind==='sets'?blankSet():kind==='recipes'?blankRecipe():kind==='profiles'?blankProfile():{id:id(),name:'Yeni malzeme',code:'',unit:'adet',price:'',currency:'TRY'};state[kind].push(v);selected[kind]=v.id;finalizing=false;}
if(action==='delete'&&obj){appDialog({title:'Kaydı sil',message:`${obj.name} kaydını silmek istiyor musunuz?`,confirmLabel:'Sil',danger:true,onConfirm:()=>{state[kind]=state[kind].filter(x=>x.id!==obj.id);selected[kind]=state[kind][0]?.id;save();render();}});return;}
if(action==='add-tax'){state.taxes.push({id:id(),name:'Yeni vergi',rate:'0'});save();render();return;}if(action==='remove-tax'){const removed=state.taxes.splice(i,1)[0];for(const set of state.sets)set.taxIds=(set.taxIds||[]).filter(id=>id!==removed?.id);save();render();return;}
if(action==='add-operation')obj.operations.push({name:state.operationNames[0],...emptyTime('batch')});
if(action==='remove-operation')obj.operations.splice(i,1);
if(action==='add-row-material')obj.rows[i].materials.push({materialId:'',size:'',fabric:'',quantity:''});
if(action==='remove-row-material')obj.rows[Number(b.dataset.rowIndex)].materials.splice(i,1);
if(action==='add-set-row'){
  obj.rows.push({recipeId:'',quantity:'1',materials:[],placement:{...emptyTime(),status:'notApplicable',coverage:'item',sets:''}});
  const rowIndex=obj.rows.length-1;
  expandedSetRows.add(obj.id+':'+rowIndex);
  setTimeout(()=>document.querySelector(`[data-path="rows.${rowIndex}.recipeId"]`)?.focus(),0);
}
if(action==='remove-set-row')obj.rows.splice(i,1);
if(action==='add-extra')obj.extras.push({name:'Hazırlık, taşıma ve yükleme',...emptyTime()});
if(action==='remove-extra')obj.extras.splice(i,1);
if(action==='add-other-expense')(obj.otherExpenses ||= []).push({name:'Yeni gider',amount:'',scope:'total'});
if(action==='remove-other-expense')obj.otherExpenses?.splice(i,1);
if(action==='export'){if(tutorial)return;const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='btxprice-yedek.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);return;}
save();render();});
document.addEventListener('click',()=>{
  const version=pendingRenderVersion,needsRender=pendingChangeRender;
  pointerPressActive=false;pendingChangeRender=false;
  if(needsRender)setTimeout(()=>{if(renderVersion===version)renderPreservingFocus();},0);
});
document.addEventListener('dblclick',e=>{if(!e.target.closest('.record-list'))return;});
window.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='Enter'&&tab==='recipes'&&!document.querySelector('#app-dialog')){e.preventDefault();addCustomOperation();}});
// Add a custom operation directly beside the standard list.
document.addEventListener('click',e=>{if(e.target.id==='custom-operation')addCustomOperation();});
render();


refreshRates();
setInterval(refreshRates,60*60*1000);
