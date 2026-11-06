export type CabinProduct = {
  slug: 'workforce' | 'urban' | 'transit-air' | 'transit-rail' | 'campus';
  number: string;
  label: string;
  name: string;
  cardCopy: string;
  intro: string;
  bestFor: string;
  stayPattern: string;
  whyItExists: string;
  features: readonly string[];
  operations: readonly string[];
};

export const CABIN_PRODUCTS: readonly CabinProduct[] = [
  {
    slug: 'workforce',
    number: '01',
    label: 'Workers',
    name: 'ASI Workforce',
    cardCopy: 'Private rooms for workers on extended assignments near industrial, logistics and construction sites.',
    intro:
      'A private-room format for people working away from home who need more than a bunk or shared dormitory. The concept combines a real bed, an en-suite bathroom and a quiet place to recover between shifts.',
    bestFor: 'Industrial parks, logistics hubs, construction projects and remote-work locations.',
    stayPattern: 'Multi-night and extended stays, including employer-arranged accommodation.',
    whyItExists:
      'Workforce accommodation is often functional but impersonal. ASI Workforce is designed around privacy, sleep quality and a consistent operating standard.',
    features: [
      'Private cabin with a real bed',
      'En-suite shower and toilet',
      'Desk, storage and practical personal space',
      'Quiet rest between shifts',
      'Digital access where supported',
      'Suitable for individual bookings or workforce blocks',
    ],
    operations: [
      'Central booking and availability management',
      'AI-assisted guest communication with human exception handling',
      'Cleaning and maintenance coordination',
      'Network-level occupancy and operating analytics',
    ],
  },
  {
    slug: 'urban',
    number: '02',
    label: 'City stays',
    name: 'ASI Cabins Urban',
    cardCopy: 'Private short- and medium-stay rooms in well-connected city locations.',
    intro:
      'A compact private room for guests who value location, privacy and a proper bathroom more than a large hotel footprint. The format is intended for suitable existing buildings in useful urban locations.',
    bestFor: 'City districts, mixed-use buildings and compact hospitality locations.',
    stayPattern: 'Short and medium stays for solo travellers, couples and business visitors.',
    whyItExists:
      'Guests often choose between expensive conventional hotels and low-privacy budget options. ASI Cabins Urban aims to offer a smaller private room without giving up the essentials.',
    features: [
      'Private room with a real bed',
      'En-suite shower and toilet',
      'Desk or practical work surface',
      'Storage for short and medium stays',
      'Efficient self check-in where supported',
      'A consistent ASI room standard across locations',
    ],
    operations: [
      'Connected reservations and channel availability',
      'Guest messaging before, during and after the stay',
      'Digital access through supported local systems',
      'Cleaning, maintenance and service-task coordination',
    ],
  },
  {
    slug: 'transit-air',
    number: '03',
    label: 'Airports',
    name: 'ASI Transit Air',
    cardCopy: 'Private sleep-and-shower cabins for passengers between flights.',
    intro:
      'A private reset space for passengers facing long connections, delays or overnight airport stays. Unlike an open sleeping pod, the concept is built around a real bed, a private bathroom and a door you can close.',
    bestFor: 'Airport terminals, airport hotels and aviation-adjacent hospitality areas.',
    stayPattern: 'Short stays measured in hours or one night, depending on location and local rules.',
    whyItExists:
      'Airports have lounges and sleeping pods, but genuine privacy is still limited. ASI Transit Air is intended to fill the gap between a chair, an open pod and a full conventional hotel room.',
    features: [
      'Private cabin with a real bed',
      'Private shower and toilet',
      'Space for luggage and personal belongings',
      'Short-stay friendly room layout',
      'Simple digital access where supported',
      'Designed for connections, delays and overnight transit',
    ],
    operations: [
      'Fast booking and availability updates',
      'Multilingual guest communication',
      'Short-turn cleaning coordination',
      'Occupancy and service monitoring across the location',
    ],
  },
  {
    slug: 'transit-rail',
    number: '04',
    label: 'Rail',
    name: 'ASI Transit Rail',
    cardCopy: 'Private rooms for passengers who need real rest between trains.',
    intro:
      'A station-oriented private-room format for travellers with long connections, early departures or overnight rail journeys. The concept provides a proper bed and bathroom close to the transport node.',
    bestFor: 'Major stations, rail hubs, intercity terminals and station districts.',
    stayPattern: 'Short stopovers, overnight stays and rest between long-distance journeys.',
    whyItExists:
      'Rail travellers frequently need somewhere to rest without travelling far from the station. ASI Transit Rail is designed to keep that stay simple, private and close to the next departure.',
    features: [
      'Private cabin with a real bed',
      'Private shower and toilet',
      'Compact luggage and storage space',
      'Useful for short stopovers',
      'Digital access where supported',
      'Designed for major station and rail-hub locations',
    ],
    operations: [
      'Reservation and availability coordination',
      'Guest communication around arrival and departure',
      'Fast cleaning and room-turnover workflows',
      'Location-level and network-level operating analytics',
    ],
  },
  {
    slug: 'campus',
    number: '05',
    label: 'Students',
    name: 'ASI Campus',
    cardCopy: 'Private rooms with a bed, desk and bathroom for students and academic visitors.',
    intro:
      'A compact private room for students, researchers and academic visitors who need quiet study space and personal privacy near a campus or education district.',
    bestFor: 'Campuses, training centres, education districts and temporary student-accommodation overflow.',
    stayPattern: 'Short academic visits through extended stays, depending on the host site and local accommodation rules.',
    whyItExists:
      'Student accommodation is often shared, noisy or inflexible. ASI Campus is intended to provide a small but genuinely private room with the essentials for sleeping, studying and everyday life.',
    features: [
      'Private room with a real bed',
      'Desk and study-friendly layout',
      'Private shower and toilet',
      'Storage for personal belongings',
      'Suitable for short or extended stays',
      'Digital access where supported',
    ],
    operations: [
      'Central reservation and occupancy management',
      'Guest communication and arrival guidance',
      'Cleaning and maintenance coordination',
      'Network reporting for host institutions and operators',
    ],
  },
] as const;

export function getCabinProduct(slug: string): CabinProduct | undefined {
  return CABIN_PRODUCTS.find((product) => product.slug === slug);
}
