export function editDeliveryAddress(deliveries, id, address) {
  const value = String(address || "").trim();
  if (!value) throw new Error("Digite o endereço antes de salvar.");
  return deliveries.map((delivery) => String(delivery.id) === String(id)
    ? { ...delivery, address: value, coords: null, geocodeError: "" }
    : delivery);
}

export function removeDeliveryById(deliveries, id) {
  return deliveries.filter((delivery) => String(delivery.id) !== String(id));
}
