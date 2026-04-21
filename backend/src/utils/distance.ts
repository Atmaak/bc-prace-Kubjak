import { Souradnice } from '../types/souradnice';
export const getGeoDistance = (p1: Souradnice, p2: Souradnice): number => {
  const R = 6371; //Radius zeme v km

  const dLat = toRad(p2.lat - p1.lat);
  const dLng = toRad(p2.lng - p1.lng);
  
  const lat1 = toRad(p1.lat);
  const lat2 = toRad(p2.lat);

  // Haversine formula
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

const toRad = (value: number): number => {
  return (value * Math.PI) / 180;
};