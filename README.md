# BTX Price

## GitHub'dan Windows kurulumu

Özel deponun [Releases](https://github.com/ardaacala/BTXPrice/releases) bölümünden istediğiniz sürümün `BTXPrice-Setup-1.1.2.exe` dosyasını indirin. Kurulum sihirbazında isteğe bağlı masaüstü kısayolunu seçebilirsiniz.

- **Boş kurulum (main):** İşletme kayıtları olmadan başlar.
- **Bu bilgisayarın kayıtlarıyla (data/local-records-2026-11-23):** Yeni kullanıcı profilinde Edge'den alınan kayıtlarla başlar. Mevcut BTXPrice kayıtlarının üzerine yazmaz. Masaüstü sürümünün ayrı JSON kaydı aynı sürümde indirilebilir ve **Ayarlar → JSON içe aktar** ile yüklenebilir.

Her iki dalın kurulum dosyası GitHub Actions ile Windows üzerinde oluşturulur ve ayrı bir sürüm olarak yayımlanır. Depo özel erişimlidir; indiren kişinin erişim izni olmalıdır. Dosyalar dijital olarak imzalı değildir; Windows güvenlik uyarısı veya Smart App Control engeli görülebilir.

Set ve yarı mamul maliyetlerini hesaplayan uygulama. Şu an doğrudan tarayıcıda, sunucu kurmadan kullanılabilir.

## Kurulumsuz tarayıcı sürümü

`web/index.html` dosyasını Microsoft Edge veya Chrome ile açın. `localhost`, ayrı sunucu, kurulum dosyası ve dijital imza gerekmez. Kaynak dosyalar güncellendiğinde `powershell -ExecutionPolicy Bypass -File .\build-web.ps1` komutu tarayıcı paketini yeniden oluşturur; normal kullanımda bu komut gerekli değildir.

Kur yenileme önce TCMB'nin `today.xml` adresini dener. Tarayıcı TCMB'nin çapraz kaynak kısıtı nedeniyle bunu engellerse, [açık kaynaklı TCMB veri aynasından](https://github.com/MehmetAkgul/currency-api-tr) EUR ve USD **döviz satış** kurlarını alır. Ayna kayıtları yalnız kaynak `tcmb` ve güncel olarak işaretliyse kullanılır; ekranda aynanın kullanıldığı ve kayıt zamanı gösterilir. Ayna üçüncü taraf hizmetidir; kaynağı işaretlemesi TCMB tarafından onaylandığı anlamına gelmez. İnternet veya her iki kaynak da kullanılamazsa dövizli maliyetler doğrulanmış fiyat olarak gösterilmez. Kurlar elle girilmez.

Tarayıcı verileri kendi yerel depolamasında tutar. Başka tarayıcıya veya farklı bir dosya konumuna geçerken **Ayarlar → JSON dışa aktar** ile yedek alıp yeni konumda **JSON içe aktar** ile geri yükleyin. Excel raporu tarayıcının indirme klasörüne kaydedilir.

## Windows kurulumu

`dist/BTXPrice-Setup-1.1.2.exe` dosyasını çalıştırın. Kurulum Biotex Price'ı kullanıcı hesabınıza yükler ve Başlat menüsüne kısayol ekler. **Masaüstüne kısayol ekle** kutusu başlangıçta boş gelir; işaretlerseniz Biotex Price logolu masaüstü kısayolu da oluşturulur. Windows'un uygulama kaldırma ekranından kaldırılabilir.

**Kişisel kullanım ve imza:** Şu an üretilmiş kurulum dosyası dijital olarak imzalı değildir. Smart App Control açıkken Windows hem kurulum dosyasını hem kurulu EXE'yi engelleyebilir; tek uygulamaya istisna tanımaz. Koruma açık kalacaksa güvenilir kod imzalama sertifikası gerekir. Kendiniz oluşturduğunuz sertifika bu engeli gidermez. Ücretsiz ve korumayı değiştirmeyen kullanım yolu, üstteki kurulumsuz tarayıcı sürümünü Microsoft Edge'de uygulama penceresi olarak açmaktır. Masaüstü kısayolunun hedefi Edge, bağımsız değişkeni `--app="file:///C:/Users/Arda%20ALACA/BTXPrice/index.html"` olabilir; proje başka konuma taşınırsa bu yol güncellenmelidir. Smart App Control'u kapatmak sistem genelindeki korumayı değiştirir ve bu yol için gerekli değildir.

Mevcut tarayıcı sürümündeki kayıtlar kurulu sürüme otomatik taşınmaz. Eski sürümde **Ayarlar → JSON dışa aktar**, kurulu sürümde **Ayarlar → JSON içe aktar** adımlarını kullanın.

Kurulum dosyasını yeniden oluşturmak için Node.js LTS ve Inno Setup 6 kurulu bir Windows bilgisayarda önce `npm ci`, sonra `powershell -ExecutionPolicy Bypass -File .\build-installer.ps1` çalıştırın. Varsayılan derleme kişisel kullanım için imzasızdır. Daha sonra imzalı sürüm istenirse Windows SDK SignTool ve güvenilir kod imzalama sertifikası edinip `powershell -ExecutionPolicy Bypass -File .\build-installer.ps1 -SignedRelease -CodeSigningThumbprint SERTIFIKA_SHA1_IZI -SignToolPath 'SIGNTOOL_EXE_TAM_YOLU'` kullanın. İmzalı derleme uygulamanın EXE ve DLL dosyalarını, kurulum dosyasını, kurulumun geçici kopyalarını ve kaldırıcıyı imzalar; imzaları doğrular.

## Uygulama içi eğitim

Sağ üst köşedeki **?** düğmesi 22 adımlı etkileşimli eğitimi açar. Eğitim, ilgili alanları yeşil çerçeve ve okla işaretler; **Önceki**, **Sonraki** ve **Konuya git** ile gezilebilir. Eğitimde örnek malzeme, yarı mamul, ambalaj profili ve set vardır. Bunları düzenleyebilir, yeni deneme kayıtları ekleyebilirsiniz. Deneme değişiklikleri yerel depolamaya yazılmaz; eğitim kapatılınca veya sayfa yenilenince kaybolur. Eğitim sırasında JSON içe ve dışa aktarma kapalıdır.

## Kullanım sırası

1. **Ayarlar** bölümünde aylık maaşı ve aylık toplam çalışma saatini girin. Saatlik ücret maaş ÷ saat, dakikalık ücret saatlik ÷ 60, saniyelik ücret saatlik ÷ 3600 olarak hesaplanır. İşçilik ek payı varsayılan olarak `%0`dır.
2. **Malzemeler** bölümünde metre, adet, metrekare veya kg birimini seçin. Birim fiyatını TL, EUR veya USD olarak girin. EUR ve USD dönüşümü için TCMB'nin en son yayımladığı **Döviz Satış** kuru uygulama açılınca internetten alınır. Kullanılan kaynak ve veri tarihi Ayarlar'da gösterilir; bağlantı kurulamazsa dövizli malzeme eksik verili sayılır.
3. **Yarı mamuller** bölümünde her varyant için ayrı reçete, malzeme miktarı ve işçilik ölçümleri girin.
4. **Ambalaj profilleri** bölümünde seçilebilir paketleme yöntemlerini ve sürelerini tanımlayın.
5. **Ayarlar → Vergi listesi** bölümünde vergi adı ve oranlarını tanımlayın. **Setler** bölümünün üstündeki **Hedef net kâr (%)** alanını, sipariş adedini ve uygulanacak vergileri seçin. Ayarlardaki kâr oranı yalnız yeni setler için varsayılandır; her sette değiştirilebilir. **Seti tamamla** düğmesine basmadan önce adet başına ve toplam maliyet, vergi gideri, net kâr ve vergiler dahil son satış fiyatı görünür. Son ekranda ayrıntılı döküm ve TCMB kuruyla hesaplanan EUR/USD karşılıkları gösterilir. **Kurları güncelle** düğmesi kuru yeniden alır. Vergi öncesi satış = temel maliyet × (1 + hedef kâr oranı / 100). Her vergi = vergi öncesi satış × ilgili vergi oranı / 100. Son satış fiyatı = vergi öncesi satış + seçili vergiler. Vergi gideri maliyet dökümünde ayrı gösterilir; net kâr = son satış fiyatı − temel maliyet − vergi gideri.

Set başlığındaki **Excel'e yazdır** düğmesi bir `.xlsx` raporu oluşturur. Özet, set içeriği, malzemeler, üretim işçiliği, sete dizme ve ambalaj ayrı sayfalardadır. Masaüstü uygulaması kayıt yerini seçmeniz için dosya kaydetme penceresi açar. Eğitim modunda deneme kayıtları Excel'e yazılmaz.

Excel dosyası yalnız veri yapısını anlamak için referans alınmıştır; otomatik başlangıç verisi yüklenmez. `DK` işaretinden süre türü çıkarılmaz. Her süre için veri durumu, süre birimi ve kişi-dakika/geçen süre türü açıkça girilir. Dakika:saniye biriminde `2:35`, 2 dakika 35 saniye anlamına gelir; saniye iki haneli ve `00–59` aralığında olmalıdır. Ondalıklı dakikada `2,5`, 2 dakika 30 saniyedir. Elle üretim ölçümünde toplam işçilik maliyeti = kişi sayısı × geçen süre × süreye uygun kişi maliyeti; adet başına maliyet için üretilen adede bölünür. Hazır kişi-dakika/adet girişi tekrar kişi sayısıyla çarpılmaz. Süre aralıkları ve metin açıklamalar sayısal değer olarak kabul edilmez.

Kayıtlar uygulamanın yerel depolamasında tutulur. Önceki sürümde yalnız dakikalık kişi maliyeti girilmişse yeni aylık maaş ve çalışma saati alanları doldurulmalıdır; uygulama saat bilgisini tahmin etmez. Ayarlar bölümünden JSON yedeği alınabilir ve geri yüklenebilir. Hesaplama kabul testleri `tests/calc.test.html` dosyası açılarak çalıştırılır.
