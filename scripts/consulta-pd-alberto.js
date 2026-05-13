// Consulta pedido de venda (PD) na API ERP - TMC Alberto
// Uso: node consulta-pd-alberto.js <numero> <loja>
// Ex:  node consulta-pd-alberto.js 717106 067
//
// IMPORTANTE — bug da API:
// O numero do PD precisa ser enviado com 12 digitos, zero-padded a esquerda.
// Exemplo: 716534 -> 000000716534
// Se enviar sem padding, a API retorna HTTP 404 com {cancelado:true, pedido:null},
// o que e enganoso — NAO significa que o pedido foi cancelado, significa
// que a API nao encontrou o documento pelo numero curto.
// O script ja faz o padStart(12, '0') automaticamente.

const http = require('http');

const CONFIG = {
  host: '159.112.189.1',
  port: 25049,
  user: 'TESTE',
  pass: '123',
};

const LOJAS = {
  '067': 'Portal Morumbi',
  '131': 'Chacara Santo Antonio',
  '132': 'Vila Andrade',
  '173': 'Jardim Guedala',
  '191': 'Vila Mascote',
};

function consultar(numero, loja) {
  const numPad = String(numero).padStart(12, '0');
  const auth = 'Basic ' + Buffer.from(`${CONFIG.user}:${CONFIG.pass}`).toString('base64');
  const path = `/consultapedidovenda/${numPad}/PD/${loja}`;

  return new Promise((resolve, reject) => {
    http.get({
      hostname: CONFIG.host,
      port: CONFIG.port,
      path,
      headers: { accept: 'application/json', Authorization: auth },
      timeout: 20000,
    }, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: r.statusCode, body: data }); }
      });
    }).on('error', reject)
      .on('timeout', () => reject(new Error('timeout')));
  });
}

(async () => {
  const [,, numero, loja] = process.argv;

  if (!numero || !loja) {
    console.log('Uso: node consulta-pd-alberto.js <numero> <loja>');
    console.log('Lojas:', Object.entries(LOJAS).map(([c,n]) => `${c}=${n}`).join(', '));
    process.exit(1);
  }

  if (!LOJAS[loja]) {
    console.log(`Loja invalida: ${loja}. Validas: ${Object.keys(LOJAS).join(', ')}`);
    process.exit(1);
  }

  try {
    const r = await consultar(numero, loja);
    console.log(`\nPD ${numero} | Loja ${loja} (${LOJAS[loja]}) | HTTP ${r.status}\n`);

    if (r.body?.pedido) {
      const p = r.body.pedido;
      console.log('STATUS: ATIVO');
      console.log(`Cliente: ${p.cliente?.nome || p.cliente?.fantasiaSobrenome || '-'}`);
      console.log(`Valor:   R$ ${p.valorContabil || p.valorTotal || '-'}`);
      console.log(`Data:    ${p.dataEmissao || p.dataCadastro || '-'}`);
      console.log(`\n--- JSON completo ---`);
      console.log(JSON.stringify(r.body, null, 2));
    } else if (r.body?.cancelado && r.body?.dadosCancelamento) {
      console.log('STATUS: CANCELADO');
      console.log(`Cliente: ${r.body.dadosCancelamento.cliente?.nome || '-'}`);
      console.log(`\n--- JSON completo ---`);
      console.log(JSON.stringify(r.body, null, 2));
    } else {
      console.log('STATUS: NAO ENCONTRADO');
      console.log(JSON.stringify(r.body, null, 2));
    }
  } catch (e) {
    console.error('ERRO:', e.message);
    process.exit(1);
  }
})();
