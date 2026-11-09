/**
 * Konum izni vermeyen kullanicinin elle sectigi sehir (2.0.18 plan madde 9). Secilen sehrin MERKEZ
 * koordinati users.lat/lng'ye yazilir (location_source='city', migration 081).
 *
 * Kaynak: statik liste — ucretli geocoding YOK. Kapsam (2026-11-09 prod): Turkiye'nin 81 il merkezi +
 * gercek kullanicilarin en cok oldugu diger 14 ulkenin (IT, DO, SA, IQ, VN, US, MX, SE, BR, JP, CN, SY,
 * JO, FR) buyuk sehirleri. Koordinatlar sehir merkezi (~0,01 derece); Discover mesafe kademesi icin
 * yeterli, kesin adres degil. Yeni ulke/sehir eklemek = bu listeye satir eklemek (id DEGISMEZ — istemci
 * id'yi sunucuya geri yollar).
 *
 * `name`: gosterilen ad (TR'de Turkce, digerlerinde yaygin Latin yazimi). `aliases`: arama icin ek
 * yazimlar (yerel alfabe, Turkce/Ingilizce ad) — yanitta donmez.
 */
export interface CityEntry {
  id: string;
  country: string;
  name: string;
  lat: number;
  lng: number;
  aliases?: readonly string[];
}

type Row = readonly [id: string, name: string, lat: number, lng: number, aliases?: readonly string[]];

function country(code: string, rows: readonly Row[]): CityEntry[] {
  return rows.map(([id, name, lat, lng, aliases]) => ({
    id: `${code}-${id}`,
    country: code,
    name,
    lat,
    lng,
    ...(aliases ? { aliases } : {}),
  }));
}

/** Plaka sirasiyla 81 il merkezi. */
const TR: readonly Row[] = [
  ["adana", "Adana", 37.0, 35.3213],
  ["adiyaman", "Adıyaman", 37.7648, 38.2786],
  ["afyonkarahisar", "Afyonkarahisar", 38.7507, 30.5567, ["Afyon"]],
  ["agri", "Ağrı", 39.7191, 43.0503],
  ["amasya", "Amasya", 40.6499, 35.8353],
  ["ankara", "Ankara", 39.9334, 32.8597],
  ["antalya", "Antalya", 36.8969, 30.7133],
  ["artvin", "Artvin", 41.1828, 41.8183],
  ["aydin", "Aydın", 37.856, 27.8416],
  ["balikesir", "Balıkesir", 39.6484, 27.8826],
  ["bilecik", "Bilecik", 40.1451, 29.9799],
  ["bingol", "Bingöl", 38.8854, 40.4983],
  ["bitlis", "Bitlis", 38.4006, 42.1095],
  ["bolu", "Bolu", 40.7392, 31.6089],
  ["burdur", "Burdur", 37.7203, 30.2908],
  ["bursa", "Bursa", 40.1885, 29.061],
  ["canakkale", "Çanakkale", 40.1553, 26.4142],
  ["cankiri", "Çankırı", 40.6013, 33.6134],
  ["corum", "Çorum", 40.5506, 34.9556],
  ["denizli", "Denizli", 37.7765, 29.0864],
  ["diyarbakir", "Diyarbakır", 37.9144, 40.2306],
  ["edirne", "Edirne", 41.6818, 26.5623],
  ["elazig", "Elazığ", 38.681, 39.2264],
  ["erzincan", "Erzincan", 39.75, 39.5],
  ["erzurum", "Erzurum", 39.9043, 41.2679],
  ["eskisehir", "Eskişehir", 39.7767, 30.5206],
  ["gaziantep", "Gaziantep", 37.0662, 37.3833, ["Antep"]],
  ["giresun", "Giresun", 40.9128, 38.3895],
  ["gumushane", "Gümüşhane", 40.4386, 39.5086],
  ["hakkari", "Hakkari", 37.5744, 43.7408],
  ["hatay", "Hatay", 36.2023, 36.1613, ["Antakya"]],
  ["isparta", "Isparta", 37.7648, 30.5566],
  ["mersin", "Mersin", 36.8121, 34.6415, ["İçel"]],
  ["istanbul", "İstanbul", 41.0082, 28.9784, ["Istanbul"]],
  ["izmir", "İzmir", 38.4237, 27.1428, ["Izmir"]],
  ["kars", "Kars", 40.6013, 43.0975],
  ["kastamonu", "Kastamonu", 41.3887, 33.7827],
  ["kayseri", "Kayseri", 38.7312, 35.4787],
  ["kirklareli", "Kırklareli", 41.7333, 27.2167],
  ["kirsehir", "Kırşehir", 39.1425, 34.1709],
  ["kocaeli", "Kocaeli", 40.7654, 29.9408, ["İzmit"]],
  ["konya", "Konya", 37.8746, 32.4932],
  ["kutahya", "Kütahya", 39.4167, 29.9833],
  ["malatya", "Malatya", 38.3552, 38.3095],
  ["manisa", "Manisa", 38.6191, 27.4289],
  ["kahramanmaras", "Kahramanmaraş", 37.5858, 36.9371, ["Maraş"]],
  ["mardin", "Mardin", 37.3212, 40.7245],
  ["mugla", "Muğla", 37.2153, 28.3636],
  ["mus", "Muş", 38.9462, 41.7539],
  ["nevsehir", "Nevşehir", 38.6939, 34.6857],
  ["nigde", "Niğde", 37.9667, 34.6833],
  ["ordu", "Ordu", 40.9839, 37.8764],
  ["rize", "Rize", 41.0201, 40.5234],
  ["sakarya", "Sakarya", 40.7569, 30.3781, ["Adapazarı"]],
  ["samsun", "Samsun", 41.2928, 36.3313],
  ["siirt", "Siirt", 37.9333, 41.95],
  ["sinop", "Sinop", 42.0231, 35.1531],
  ["sivas", "Sivas", 39.7477, 37.0179],
  ["tekirdag", "Tekirdağ", 40.9781, 27.5117],
  ["tokat", "Tokat", 40.3167, 36.55],
  ["trabzon", "Trabzon", 41.0015, 39.7178],
  ["tunceli", "Tunceli", 39.1079, 39.5401],
  ["sanliurfa", "Şanlıurfa", 37.1591, 38.7969, ["Urfa"]],
  ["usak", "Uşak", 38.6823, 29.4082],
  ["van", "Van", 38.4891, 43.4089],
  ["yozgat", "Yozgat", 39.8181, 34.8147],
  ["zonguldak", "Zonguldak", 41.4564, 31.7987],
  ["aksaray", "Aksaray", 38.3687, 34.037],
  ["bayburt", "Bayburt", 40.2552, 40.2249],
  ["karaman", "Karaman", 37.1759, 33.2287],
  ["kirikkale", "Kırıkkale", 39.8468, 33.5153],
  ["batman", "Batman", 37.8812, 41.1351],
  ["sirnak", "Şırnak", 37.5164, 42.4611],
  ["bartin", "Bartın", 41.6344, 32.3375],
  ["ardahan", "Ardahan", 41.1105, 42.7022],
  ["igdir", "Iğdır", 39.9237, 44.045],
  ["yalova", "Yalova", 40.65, 29.2667],
  ["karabuk", "Karabük", 41.2061, 32.6204],
  ["kilis", "Kilis", 36.7184, 37.1212],
  ["osmaniye", "Osmaniye", 37.0742, 36.2478],
  ["duzce", "Düzce", 40.8438, 31.1565],
];

const IT: readonly Row[] = [
  ["roma", "Roma", 41.9028, 12.4964, ["Rome"]],
  ["milano", "Milano", 45.4642, 9.19, ["Milan"]],
  ["napoli", "Napoli", 40.8518, 14.2681, ["Naples"]],
  ["torino", "Torino", 45.0703, 7.6869, ["Turin"]],
  ["palermo", "Palermo", 38.1157, 13.3615],
  ["genova", "Genova", 44.4056, 8.9463, ["Genoa"]],
  ["bologna", "Bologna", 44.4949, 11.3426],
  ["firenze", "Firenze", 43.7696, 11.2558, ["Florence", "Floransa"]],
  ["bari", "Bari", 41.1171, 16.8719],
  ["catania", "Catania", 37.5079, 15.083],
  ["venezia", "Venezia", 45.4408, 12.3155, ["Venice", "Venedik"]],
  ["verona", "Verona", 45.4384, 10.9916],
];

const DO: readonly Row[] = [
  ["santo-domingo", "Santo Domingo", 18.4861, -69.9312],
  ["santiago", "Santiago de los Caballeros", 19.4517, -70.697, ["Santiago"]],
  ["san-pedro-de-macoris", "San Pedro de Macorís", 18.4539, -69.3086],
  ["la-romana", "La Romana", 18.4273, -68.9728],
  ["san-francisco-de-macoris", "San Francisco de Macorís", 19.3008, -70.2526],
  ["puerto-plata", "Puerto Plata", 19.7934, -70.6884],
  ["punta-cana", "Punta Cana", 18.5601, -68.3725],
];

const SA: readonly Row[] = [
  ["riyadh", "Riyadh", 24.7136, 46.6753, ["الرياض", "Riyad"]],
  ["jeddah", "Jeddah", 21.4858, 39.1925, ["جدة", "Cidde"]],
  ["mecca", "Mecca", 21.3891, 39.8579, ["مكة", "Makkah", "Mekke"]],
  ["medina", "Medina", 24.5247, 39.5692, ["المدينة", "Madinah", "Medine"]],
  ["dammam", "Dammam", 26.4207, 50.0888, ["الدمام"]],
  ["khobar", "Khobar", 26.2172, 50.1971, ["الخبر"]],
  ["taif", "Taif", 21.2703, 40.4158, ["الطائف"]],
  ["tabuk", "Tabuk", 28.3835, 36.5662, ["تبوك"]],
  ["abha", "Abha", 18.2164, 42.5053, ["أبها"]],
];

const IQ: readonly Row[] = [
  ["baghdad", "Baghdad", 33.3152, 44.3661, ["بغداد", "Bağdat"]],
  ["basra", "Basra", 30.5085, 47.7804, ["البصرة"]],
  ["mosul", "Mosul", 36.3489, 43.1577, ["الموصل", "Musul"]],
  ["erbil", "Erbil", 36.1912, 44.0092, ["أربيل", "Hewlêr"]],
  ["sulaymaniyah", "Sulaymaniyah", 35.565, 45.4329, ["السليمانية", "Süleymaniye"]],
  ["kirkuk", "Kirkuk", 35.4681, 44.3922, ["كركوك", "Kerkük"]],
  ["najaf", "Najaf", 32.0259, 44.3462, ["النجف", "Necef"]],
  ["karbala", "Karbala", 32.616, 44.0249, ["كربلاء", "Kerbela"]],
  ["duhok", "Duhok", 36.8669, 42.9503, ["دهوك"]],
];

const VN: readonly Row[] = [
  ["ho-chi-minh-city", "Ho Chi Minh City", 10.8231, 106.6297, ["Thành phố Hồ Chí Minh", "Saigon", "Sài Gòn"]],
  ["hanoi", "Hanoi", 21.0278, 105.8342, ["Hà Nội"]],
  ["da-nang", "Da Nang", 16.0544, 108.2022, ["Đà Nẵng"]],
  ["hai-phong", "Hai Phong", 20.8449, 106.6881, ["Hải Phòng"]],
  ["can-tho", "Can Tho", 10.0452, 105.7469, ["Cần Thơ"]],
  ["nha-trang", "Nha Trang", 12.2388, 109.1967],
  ["hue", "Hue", 16.4637, 107.5909, ["Huế"]],
];

const US: readonly Row[] = [
  ["new-york", "New York", 40.7128, -74.006, ["NYC"]],
  ["los-angeles", "Los Angeles", 34.0522, -118.2437, ["LA"]],
  ["chicago", "Chicago", 41.8781, -87.6298],
  ["houston", "Houston", 29.7604, -95.3698],
  ["phoenix", "Phoenix", 33.4484, -112.074],
  ["philadelphia", "Philadelphia", 39.9526, -75.1652],
  ["san-antonio", "San Antonio", 29.4241, -98.4936],
  ["san-diego", "San Diego", 32.7157, -117.1611],
  ["dallas", "Dallas", 32.7767, -96.797],
  ["san-francisco", "San Francisco", 37.7749, -122.4194],
  ["miami", "Miami", 25.7617, -80.1918],
  ["seattle", "Seattle", 47.6062, -122.3321],
  ["boston", "Boston", 42.3601, -71.0589],
  ["washington", "Washington, D.C.", 38.9072, -77.0369],
  ["atlanta", "Atlanta", 33.749, -84.388],
];

const MX: readonly Row[] = [
  ["ciudad-de-mexico", "Ciudad de México", 19.4326, -99.1332, ["Mexico City", "CDMX"]],
  ["guadalajara", "Guadalajara", 20.6597, -103.3496],
  ["monterrey", "Monterrey", 25.6866, -100.3161],
  ["puebla", "Puebla", 19.0414, -98.2063],
  ["tijuana", "Tijuana", 32.5149, -117.0382],
  ["leon", "León", 21.125, -101.686],
  ["queretaro", "Querétaro", 20.5888, -100.3899],
  ["merida", "Mérida", 20.9674, -89.5926],
  ["cancun", "Cancún", 21.1619, -86.8515],
];

const SE: readonly Row[] = [
  ["stockholm", "Stockholm", 59.3293, 18.0686],
  ["goteborg", "Göteborg", 57.7089, 11.9746, ["Gothenburg"]],
  ["malmo", "Malmö", 55.605, 13.0038],
  ["uppsala", "Uppsala", 59.8586, 17.6389],
  ["vasteras", "Västerås", 59.6099, 16.5448],
  ["orebro", "Örebro", 59.2753, 15.2134],
  ["linkoping", "Linköping", 58.4108, 15.6214],
];

const BR: readonly Row[] = [
  ["sao-paulo", "São Paulo", -23.5505, -46.6333],
  ["rio-de-janeiro", "Rio de Janeiro", -22.9068, -43.1729],
  ["brasilia", "Brasília", -15.7975, -47.8919],
  ["salvador", "Salvador", -12.9777, -38.5016],
  ["fortaleza", "Fortaleza", -3.7319, -38.5267],
  ["belo-horizonte", "Belo Horizonte", -19.9167, -43.9345],
  ["manaus", "Manaus", -3.119, -60.0217],
  ["curitiba", "Curitiba", -25.4284, -49.2733],
  ["recife", "Recife", -8.0476, -34.877],
  ["porto-alegre", "Porto Alegre", -30.0346, -51.2177],
];

const JP: readonly Row[] = [
  ["tokyo", "Tokyo", 35.6762, 139.6503, ["東京"]],
  ["osaka", "Osaka", 34.6937, 135.5023, ["大阪"]],
  ["yokohama", "Yokohama", 35.4437, 139.638, ["横浜"]],
  ["nagoya", "Nagoya", 35.1815, 136.9066, ["名古屋"]],
  ["sapporo", "Sapporo", 43.0618, 141.3545, ["札幌"]],
  ["fukuoka", "Fukuoka", 33.5904, 130.4017, ["福岡"]],
  ["kobe", "Kobe", 34.6901, 135.1956, ["神戸"]],
  ["kyoto", "Kyoto", 35.0116, 135.7681, ["京都"]],
  ["sendai", "Sendai", 38.2682, 140.8694, ["仙台"]],
  ["hiroshima", "Hiroshima", 34.3853, 132.4553, ["広島"]],
];

const CN: readonly Row[] = [
  ["beijing", "Beijing", 39.9042, 116.4074, ["北京", "Pekin"]],
  ["shanghai", "Shanghai", 31.2304, 121.4737, ["上海", "Şanghay"]],
  ["guangzhou", "Guangzhou", 23.1291, 113.2644, ["广州"]],
  ["shenzhen", "Shenzhen", 22.5431, 114.0579, ["深圳"]],
  ["chengdu", "Chengdu", 30.5728, 104.0668, ["成都"]],
  ["chongqing", "Chongqing", 29.563, 106.5516, ["重庆"]],
  ["wuhan", "Wuhan", 30.5928, 114.3055, ["武汉"]],
  ["hangzhou", "Hangzhou", 30.2741, 120.1551, ["杭州"]],
  ["xian", "Xi'an", 34.3416, 108.9398, ["西安"]],
  ["nanjing", "Nanjing", 32.0603, 118.7969, ["南京"]],
  ["tianjin", "Tianjin", 39.3434, 117.3616, ["天津"]],
];

const SY: readonly Row[] = [
  ["damascus", "Damascus", 33.5138, 36.2765, ["دمشق", "Şam"]],
  ["aleppo", "Aleppo", 36.2021, 37.1343, ["حلب", "Halep"]],
  ["homs", "Homs", 34.7324, 36.7137, ["حمص", "Humus"]],
  ["latakia", "Latakia", 35.5317, 35.7901, ["اللاذقية", "Lazkiye"]],
  ["hama", "Hama", 35.1318, 36.7578, ["حماة"]],
  ["tartus", "Tartus", 34.889, 35.8866, ["طرطوس"]],
  ["deir-ez-zor", "Deir ez-Zor", 35.3359, 40.1408, ["دير الزور"]],
];

const JO: readonly Row[] = [
  ["amman", "Amman", 31.9454, 35.9284, ["عمّان", "عمان"]],
  ["zarqa", "Zarqa", 32.0728, 36.088, ["الزرقاء"]],
  ["irbid", "Irbid", 32.5556, 35.85, ["إربد"]],
  ["aqaba", "Aqaba", 29.5321, 35.0063, ["العقبة", "Akabe"]],
  ["salt", "Salt", 32.0392, 35.7272, ["السلط"]],
  ["madaba", "Madaba", 31.716, 35.7939, ["مادبا"]],
];

const FR: readonly Row[] = [
  ["paris", "Paris", 48.8566, 2.3522],
  ["marseille", "Marseille", 43.2965, 5.3698],
  ["lyon", "Lyon", 45.764, 4.8357],
  ["toulouse", "Toulouse", 43.6047, 1.4442],
  ["nice", "Nice", 43.7102, 7.262],
  ["nantes", "Nantes", 47.2184, -1.5536],
  ["strasbourg", "Strasbourg", 48.5734, 7.7521],
  ["montpellier", "Montpellier", 43.6108, 3.8767],
  ["bordeaux", "Bordeaux", 44.8378, -0.5792],
  ["lille", "Lille", 50.6292, 3.0573],
];

export const CITIES: readonly CityEntry[] = [
  ...country("TR", TR),
  ...country("IT", IT),
  ...country("DO", DO),
  ...country("SA", SA),
  ...country("IQ", IQ),
  ...country("VN", VN),
  ...country("US", US),
  ...country("MX", MX),
  ...country("SE", SE),
  ...country("BR", BR),
  ...country("JP", JP),
  ...country("CN", CN),
  ...country("SY", SY),
  ...country("JO", JO),
  ...country("FR", FR),
];
