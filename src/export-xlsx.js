import {calculateSet, laborRates, materialPriceTL, number, personMinutes, recipeLabor, placementLabor, hasDuration} from './calc.js';

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

export function buildSetWorkbook(set,state,ExcelJS) {
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
