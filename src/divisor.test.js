import dividir from './divisor.js';

describe('Divisor', () => {
  it('deberia dividir 2 numeros', async () => {
    expect(dividir(10, 2)).toBe(5);
  });
});
