import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {tutorialState} from '../src/tutorial.js';
import {buildSetWorkbook} from '../src/export-xlsx.js';

const state=tutorialState({usdTry:'40',eurTry:'45',ratesVerified:true});
const set={...state.sets[0],orderQuantity:'14',shippingBoxSize:'10',shippingBoxPrice:'100',sterilizationPerBox:'50'};
const workbook=buildSetWorkbook(set,state,ExcelJS);
const summary=workbook.getWorksheet('Özet');
const expenses=workbook.getWorksheet('Ek Giderler');
assert.equal(summary.getCell('D23').value,16.42,'İdari işçilik özet satırında görünmeli');
assert.equal(summary.getCell('D24').value,32.84,'Toplam işçilik özet satırında görünmeli');
assert.equal(expenses.getCell('A6').value,'Sterilizasyon','Sterilizasyon ayrı gider satırı olmalı');
assert.equal(expenses.getCell('G6').value,100,'Eksik dolu son koli tam sayılmalı');
assert.ok((await workbook.xlsx.writeBuffer()).byteLength>0,'Excel dosyası oluşturulmalı');
console.log('Excel raporu doğrulandı.');
