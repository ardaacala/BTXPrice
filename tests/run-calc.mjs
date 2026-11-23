globalThis.document = {
  querySelector() {
    return { set textContent(value) {} };
  },
  body: { dataset: {} }
};

await import('./calc.test.js');
const passed = Number(document.body.dataset.passed);
if (!Number.isInteger(passed) || passed < 1) throw new Error('Hesaplama testleri çalışmadı.');
console.log(`${passed} hesaplama testi geçti.`);
