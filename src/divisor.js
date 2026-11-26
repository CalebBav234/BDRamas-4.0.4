export default function dividir(a, b) {
  try {
    return a / b;
  } catch (error) {
    throw new Error("Error al dividir: " + error.message);
  }
}
