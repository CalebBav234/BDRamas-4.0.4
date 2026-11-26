import potencia from './potencia.js';

describe('Potencia', () => {
  it('deberia elevar un numero a su potencia', async () => {
    expect(potencia(2, 3)).toBe(8);
  });
});
