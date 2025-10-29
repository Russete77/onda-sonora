# ONDA SONORA Run Tracker

App oficial da corrida ONDA SONORA com rastreamento GPS em tempo real de máxima precisão.

## Funcionalidades

- **Rastreamento em Tempo Real Ultra-Preciso**: Utiliza Geolocation API com configurações otimizadas para máxima precisão e menor delay possível
- **Integração Mapbox**: Mapa interativo com tema dark moderno e visualização 3D
- **PWA (Progressive Web App)**: Funciona offline e pode ser instalado no celular como app nativo
- **Visualização de Percurso**: Linha de trajeto em tempo real mostrando o caminho percorrido
- **Ícone de Corredor Animado**: Marcador customizado com animação e orientação baseada na direção do movimento
- **Estatísticas ao Vivo**:
  - Precisão GPS em metros
  - Velocidade atual em km/h
  - Coordenadas geográficas
  - Número de pontos registrados
- **Design Clean e Moderno**: Interface minimalista com efeitos glassmorphism e gradientes

## Tecnologias

- **Next.js 16** (App Router)
- **Mapbox GL JS** - Mapas interativos de alta qualidade
- **TypeScript** - Type safety
- **Tailwind CSS** - Estilização
- **next-pwa** - Progressive Web App
- **Geolocation API** - GPS de alta precisão

## Configuração

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar Mapbox Token

1. Crie uma conta em [Mapbox](https://account.mapbox.com/auth/signup/)
2. Obtenha seu token em [Access Tokens](https://account.mapbox.com/access-tokens/)
3. Copie o arquivo `.env.local.example` para `.env.local`:

```bash
cp .env.local.example .env.local
```

4. Adicione seu token no arquivo `.env.local`:

```env
NEXT_PUBLIC_MAPBOX_TOKEN=seu_token_aqui
```

### 3. Executar em desenvolvimento

```bash
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000) no navegador.

### 4. Build para produção

```bash
npm run build
npm start
```

## Uso

1. **Abra o app** no navegador (preferencialmente no celular)
2. **Permita acesso à localização** quando solicitado
3. **Clique em "Iniciar Rastreamento"** para começar
4. **Acompanhe** sua corrida em tempo real no mapa

### Dicas para Máxima Precisão

- Use em ambiente externo com visão clara do céu
- Ative o GPS do dispositivo em modo "Alta precisão"
- Aguarde alguns segundos para o GPS estabilizar (precisão < 10m)
- Evite áreas com muitos prédios altos (efeito canyon)

## Configurações Técnicas de Precisão

O app utiliza as seguintes configurações otimizadas:

```typescript
{
  enableHighAccuracy: true,    // Ativa GPS de alta precisão
  timeout: 5000,               // 5 segundos de timeout
  maximumAge: 0,               // Sem cache de posições antigas
  distanceFilter: 1            // Atualiza a cada 1 metro
}
```

## Estrutura do Projeto

```
nightrun/
├── app/
│   ├── layout.tsx          # Layout principal com PWA metadata
│   ├── page.tsx            # Página principal
│   └── globals.css         # Estilos globais
├── components/
│   └── MapboxTracker.tsx   # Componente principal do mapa
├── hooks/
│   └── useGeolocation.ts   # Hook customizado de geolocalização
└── public/
    ├── manifest.json       # PWA manifest
    ├── runner-icon.svg     # Ícone do corredor
    └── icon.svg            # Ícone do app
```

## Otimizações de Performance

- **Service Worker**: Cache inteligente de tiles do Mapbox
- **Dynamic Import**: Carregamento lazy do componente de mapa (ssr: false)
- **Filtro de Distância**: Reduz atualizações desnecessárias
- **Animações Suaves**: Transições otimizadas com CSS/GPU
- **Cálculo Haversine**: Medição precisa de distâncias

## Próximas Melhorias

- [ ] Salvar histórico de corridas
- [ ] Estatísticas detalhadas (distância total, tempo, pace)
- [ ] Compartilhamento de percursos
- [ ] Integração com wearables
- [ ] Modo offline completo
- [ ] Alertas de pace/km

## Suporte

Para dúvidas ou problemas:
1. Verifique se o token do Mapbox está configurado
2. Confirme permissões de localização no navegador
3. Teste em ambiente externo com GPS ativo
4. Verifique console do navegador para erros

---

Desenvolvido para **ONDA SONORA** - Corrida Oficial
