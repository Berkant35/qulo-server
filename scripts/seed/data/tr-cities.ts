export interface TrCity {
  name: string;
  lat: number;
  lng: number;
  count: number;
}

export const TR_CITIES: TrCity[] = [
  { name: 'İstanbul',    lat: 41.0082, lng: 28.9784, count: 70 },
  { name: 'Ankara',      lat: 39.9334, lng: 32.8597, count: 50 },
  { name: 'İzmir',       lat: 38.4192, lng: 27.1287, count: 40 },
  { name: 'Bursa',       lat: 40.1885, lng: 29.0610, count: 25 },
  { name: 'Antalya',     lat: 36.8969, lng: 30.7133, count: 25 },
  { name: 'Adana',       lat: 37.0000, lng: 35.3213, count: 18 },
  { name: 'Konya',       lat: 37.8746, lng: 32.4932, count: 18 },
  { name: 'Gaziantep',   lat: 37.0662, lng: 37.3833, count: 18 },
  { name: 'Kayseri',     lat: 38.7322, lng: 35.4853, count: 14 },
  { name: 'Eskişehir',   lat: 39.7767, lng: 30.5206, count: 14 },
  { name: 'Trabzon',     lat: 41.0027, lng: 39.7168, count: 14 },
  { name: 'Mersin',      lat: 36.8121, lng: 34.6415, count: 14 },
  { name: 'Samsun',      lat: 41.2867, lng: 36.3300, count: 12 },
  { name: 'Diyarbakır',  lat: 37.9144, lng: 40.2306, count: 10 },
  { name: 'Erzurum',     lat: 39.9000, lng: 41.2700, count: 8  },
];

export const TOTAL_QUOTA = TR_CITIES.reduce((a, c) => a + c.count, 0);
