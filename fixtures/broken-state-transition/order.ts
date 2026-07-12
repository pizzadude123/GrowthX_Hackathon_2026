order.status = 'paid';
charge(order);
order.status = 'pending';
