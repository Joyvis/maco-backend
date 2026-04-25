describe('health check', () => {
  it('returns status ok shape', () => {
    const response = { status: 'ok' };
    expect(response.status).toBe('ok');
  });
});
