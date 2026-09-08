export const products = [
  {
    id: 'farm-fresh',
    name: 'Farm Fresh Milk',
    size: '1 litre',
    price: 68,
    mrp: 72,
    image: '/assets/images/Glass_milk.png',
    badge: 'Bestseller',
    description: 'Pure, creamy goodness from grass-fed cows, chilled fresh every morning.',
  },
  {
    id: 'nandini',
    name: 'Nandini Toned Milk',
    size: '500 ml',
    price: 28,
    mrp: 30,
    image: '/assets/images/milk1.png',
    badge: 'Fresh',
    description: 'Balanced everyday milk with dependable quality and a clean taste.',
  },
  {
    id: 'amul',
    name: 'Amul Moti Milk',
    size: '450 ml',
    price: 35,
    mrp: 38,
    image: '/assets/images/milk2.jpg',
    badge: 'Popular',
    description: 'Convenient, wholesome toned milk for tea, coffee and breakfast.',
  },
  {
    id: 'madhusudan',
    name: 'Full Cream Milk',
    size: '500 ml',
    price: 36,
    mrp: 36,
    image: '/assets/images/milk3.jpg',
    description: 'Rich full-cream milk with a smooth body and naturally creamy flavour.',
  },
  {
    id: 'farmers',
    name: 'Farmers’ Milk',
    size: '1 litre',
    price: 72,
    mrp: 78,
    image: '/assets/images/milk4.jpg',
    description: 'Naturally sourced milk packed in a practical family-size carton.',
  },
  {
    id: 'milma',
    name: 'Milma Prime',
    size: '500 ml',
    price: 32,
    mrp: 34,
    image: '/assets/images/milk5.jpg',
    badge: 'New',
    description: 'Pasteurised standardised milk with a rich and satisfying finish.',
  },
  {
    id: 'medha',
    name: 'Medha Gold',
    size: '500 ml',
    price: 34,
    mrp: 37,
    image: '/assets/images/milk6.jpg',
    description: 'Creamy premium milk made for families who prefer a fuller taste.',
  },
  {
    id: 'classic-cow',
    name: 'Classic Cow Milk',
    size: '500 ml',
    price: 40,
    mrp: 45,
    image: '/assets/images/milk7.jpg',
    badge: 'Organic',
    description: 'Classic farm-style cow milk with freshness sealed inside.',
  },
]

export const savedAddresses = [
  { id: 'home', label: 'Home', detail: '22, Green Park Road, Bengaluru 560003' },
  { id: 'work', label: 'Work', detail: '4th Floor, Orion Tech Park, Whitefield, Bengaluru 560066' },
]

// Ordered stages a live order moves through, used by the tracking timeline.
export const orderStages = ['Confirmed', 'Packed', 'Out for delivery', 'Delivered']

export const initialOrders = [
  {
    id: 'MM1048',
    date: '17 Jul 2026',
    time: '6:00 – 8:00 AM',
    status: 'Out for delivery',
    total: 136,
    itemCount: 2,
    items: ['2 × Farm Fresh Milk'],
    address: '22, Green Park Road, Bengaluru',
  },
  {
    id: 'MM1033',
    date: '15 Jul 2026',
    time: '6:00 – 8:00 AM',
    status: 'Delivered',
    total: 100,
    itemCount: 3,
    items: ['1 × Nandini Toned Milk', '2 × Full Cream Milk'],
    address: '22, Green Park Road, Bengaluru',
  },
]

export const transactions = [
  { id: 1, label: 'Wallet top-up', date: '16 Jul, 5:24 PM', amount: 500, type: 'credit' },
  { id: 2, label: 'Order #MM1033', date: '15 Jul, 7:42 AM', amount: 100, type: 'debit' },
  { id: 3, label: 'Promotional bonus', date: '12 Jul, 9:10 AM', amount: 50, type: 'credit' },
  { id: 4, label: 'Order #MM1019', date: '10 Jul, 6:31 AM', amount: 136, type: 'debit' },
]

export const riderTransactions = [
  { id: 1, label: 'Delivery payout', date: '16 Jul, 8:05 PM', amount: 240, type: 'credit' },
  { id: 2, label: 'Weekly settlement', date: '14 Jul, 7:30 PM', amount: 620, type: 'debit' },
  { id: 3, label: 'Incentive bonus', date: '12 Jul, 9:15 PM', amount: 150, type: 'credit' },
]

export const notifications = [
  {
    id: 1,
    title: 'Your order is on the way',
    body: 'Delivery #MM1048 will reach you between 6:00 and 8:00 AM.',
    time: '10 min ago',
    unread: true,
  },
  {
    id: 2,
    title: 'Wallet updated',
    body: '₹500 was added successfully to your Milky Mart wallet.',
    time: 'Yesterday',
    unread: true,
  },
  {
    id: 3,
    title: 'Fresh morning offer',
    body: 'Save 10% when you schedule milk for 7 consecutive mornings.',
    time: '2 days ago',
    unread: false,
  },
]

export const riderDeliveries = [
  {
    id: 'MM1048',
    customer: 'Aarav Sharma',
    phone: '+91 98765 43210',
    address: '22, Green Park Road, Bengaluru',
    slot: '6:00 – 8:00 AM',
    items: '2 × Farm Fresh Milk',
    amount: 136,
    payment: 'Prepaid',
    status: 'Assigned',
  },
  {
    id: 'MM1051',
    customer: 'Meera Nair',
    phone: '+91 98761 22882',
    address: '16, Lake View Avenue, Bengaluru',
    slot: '6:00 – 8:00 AM',
    items: '1 × Milma Prime, 1 × Nandini Milk',
    amount: 60,
    payment: 'Cash on delivery',
    status: 'Assigned',
  },
  {
    id: 'MM1042',
    customer: 'Kabir Singh',
    phone: '+91 98110 44120',
    address: '8, MG Layout, Bengaluru',
    slot: '5:00 – 7:00 AM',
    items: '2 × Full Cream Milk',
    amount: 72,
    payment: 'Prepaid',
    status: 'Completed',
  },
]
