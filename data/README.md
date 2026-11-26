# Bu bilgisayardaki BTXPrice kayıtları

Bu dal, 23 Kasım 2026 tarihinde bilgisayardaki BTXPrice yerel depolamasından alınan iki ayrı JSON yedeğini ve 1.1.4 kurulumu için uyarlanmış kopyalarını içerir.

- `edge-2026-11-23.json`: Microsoft Edge tarayıcı sürümü. 8 malzeme, 9 yarı mamul, 1 ambalaj profili ve 2 set.
- `desktop-2026-11-23.json`: Biotex Price masaüstü sürümü. 7 malzeme, 9 yarı mamul, 1 ambalaj profili ve 1 set.
- `edge-labor-1.1.4.json`: Edge kaydının güncel set malzemesi yapısına taşınmış kopyası. 1.1.4 kurulumunun başlangıç verisidir.
- `desktop-labor-1.1.4.json`: Masaüstü kaydının aynı şekilde taşınmış kopyası. İstenirse JSON içe aktar ile yüklenir.

1.1.3 ve 1.2.0 için hazırlanmış JSON kopyaları da karşılaştırma ve eski sürüme dönüş için saklanır.

Edge ve masaüstü kayıtları ayrı tutuldu. Aynı kimliğe sahip kayıtların içerikleri farklı olabilir. Uyarlama, yarı mamuldeki malzeme tüketimini ilgili set satırlarına kopyalar; işlem sürelerini, malzeme fiyatlarını ve kayıt kimliklerini değiştirmez. Koli kapasitesi veya koli başı kargo fiyatı eski kayıtta yoksa bunlar tahmin edilmez. Orijinal JSON yedekleri saklanır. Yeni kullanıcı profilinde kurulum yalnız uyarlanmış Edge kopyasını başlangıçta açar; mevcut kayıtların üzerine yazmaz. Diğer kopyayı yüklemek için **Ayarlar → JSON içe aktar** seçin. İçe aktarma mevcut kayıtların yerine geçer; önce mevcut verileri **JSON dışa aktar** ile yedekleyin.

Uyarlama `node data/migrate-labor-records.mjs` ile tekrar üretilebilir. Script, yarı mamul, işlem ve set satırı sayılarının korunmasını doğrular.

Bu dal işçilik ve fiyatlandırma gibi özel işletme verileri içerir. Depo erişimini özel tutun.
