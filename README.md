
# RotaSpeed App - README

Um painel web para entregadores organizarem e otimizarem suas entregas diárias, com reconhecimento de endereços e geração de rotas otimizadas usando IA do Gemini. Esta versão integra Supabase para gerenciamento de usuários, planos e limites de uso, além de novas funcionalidades.

## Funcionalidades Principais

*   **Autenticação de Usuários:** Login e cadastro seguros via Supabase Auth (Email/Senha e Google).
*   **Criação de Perfil via Edge Function:** Se o perfil do usuário não existir na tabela `usuarios_rotaspeed` após o login, a Edge Function `sync-user-profile` é chamada para criá-lo.
*   **Recuperação de Senha:** Funcionalidade "Esqueci minha senha".
*   **Plano Gratuito com Limite:** Novos usuários ganham 10 entregas grátis.
*   **Gerenciamento de Planos e Limites:**
    *   Controle de plano ativo.
    *   Limite diário de entregas (`entregas_dia_max`) conforme o plano do usuário.
    *   Contagem de entregas realizadas no dia (`entregas_hoje`).
    *   Reset diário automático de `entregas_hoje` via Cron Job.
*   **Entrada de Pacotes Flexível:** Adicione endereços via texto, foto, câmera, voz, PDF ou planilhas.
*   **Gerenciamento de Entregas no Supabase:**
    *   Pacotes/Entregas são salvos na tabela `entregas`.
    *   Status (`pendente`, `em_rota`, `entregue`, `cancelada`) atualizado no banco de dados.
*   **Reconhecimento Inteligente:** IA (Gemini) para extrair dados de endereços.
*   **Otimização de Rotas:** Automática (IA) ou manual.
*   **Acompanhamento de Entregas:** Marque pacotes como entregues ou cancelados.
*   **Navegação Fácil:** Abrir endereço no app de mapas preferido (Google Maps, Waze, Apple Maps).
*   **Estatísticas:** Visualização de desempenho, entregas por status, bairro e dia.
*   **Configurações do Usuário:** Personalizar nome, nome de entregador, telefone, app de navegação e preferências de notificação.
*   **Página "Como Usar":** Instruções básicas sobre o app.

## Configuração e Execução

### Pré-requisitos

*   Node.js e npm/yarn (opcional, para desenvolvimento local se usar bundler)
*   Uma conta Supabase (seu projeto ID é `zhjzqrddmigczdfxvfhp`)
*   Uma chave de API do Google Gemini

### 1. Configuração do Supabase

#### a. Crie seu Projeto Supabase
   Seu projeto ID é `zhjzqrddmigczdfxvfhp`. Certifique-se de que está usando este projeto.

#### b. Configuração da Autenticação
   *   No seu painel Supabase (projeto `zhjzqrddmigczdfxvfhp`), vá para "Authentication" -> "Providers".
   *   **Email:** Certifique-se de que "Email" está habilitado.
   *   **Google:** Habilite o provedor "Google".
        1. Você precisará configurar as credenciais do OAuth do Google Cloud Console. Siga as [instruções do Supabase para OAuth com Google](https://supabase.com/docs/guides/auth/social-login/auth-google) para o processo detalhado.
        4. Certifique-se de adicionar `https://zhjzqrddmigczdfxvfhp.supabase.co/auth/v1/callback` como uma das "Authorized redirect URIs" (URIs de redirecionamento autorizadas) na configuração do seu cliente OAuth 2.0 no Google Cloud Console.
   *   Em "Authentication" -> "Settings" (no seu projeto `zhjzqrddmigczdfxvfhp`):
        *   **Site URL:** Defina como a URL onde seu aplicativo será hospedado. Para sua Vercel deployment, use `https://aplicativo-iota.vercel.app/`.
        *   **Additional Redirect URLs:** Adicione `https://aplicativo-iota.vercel.app/*` e, para desenvolvimento local, `http://localhost:<PORTA>/*` (substitua `<PORTA>` pela porta que você usa localmente).
        *   Você pode configurar "Disable email confirmations" (para facilitar testes de cadastro por email) ou personalizar templates de e-mail.

#### c. Configuração do Banco de Dados

##### Tabela `usuarios_rotaspeed`
   Crie ou modifique a tabela `usuarios_rotaspeed` para incluir todos os campos necessários. O campo `ultima_atualizacao` é coberto pelo trigger em `updated_at`.

   ```sql
   CREATE TABLE IF NOT EXISTS public.usuarios_rotaspeed (
       id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
       email character varying,
       nome text, -- Nome do usuário (ex: vindo do Google Profile ou input)
       plano_nome character varying DEFAULT 'Grátis'::character varying,
       entregas_dia_max integer DEFAULT 10, -- Limite para plano Grátis
       entregas_hoje integer DEFAULT 0,
       saldo_creditos integer DEFAULT 0,
       plano_ativo boolean DEFAULT true,
       entregas_gratis_utilizadas integer DEFAULT 0,
       driver_name text, -- Nome do entregador para notificações (pode ser diferente de 'nome')
       driver_phone text,
       navigation_preference text DEFAULT 'google', -- 'google', 'waze', 'apple'
       notification_sender_preference text DEFAULT 'driver', -- 'driver', 'system'
       created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
       updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL, -- ultima_atualizacao
       CONSTRAINT usuarios_rotaspeed_pkey PRIMARY KEY (id),
       CONSTRAINT usuarios_rotaspeed_email_key UNIQUE (email)
   );
   
   -- Ativar RLS
   ALTER TABLE public.usuarios_rotaspeed ENABLE ROW LEVEL SECURITY;

   -- Políticas RLS
   DROP POLICY IF EXISTS "Permitir leitura para proprietário" ON public.usuarios_rotaspeed;
   CREATE POLICY "Permitir leitura para proprietário"
   ON public.usuarios_rotaspeed
   FOR SELECT
   USING (auth.uid() = id);

   DROP POLICY IF EXISTS "Permitir atualização para proprietário" ON public.usuarios_rotaspeed;
   CREATE POLICY "Permitir atualização para proprietário"
   ON public.usuarios_rotaspeed
   FOR UPDATE
   USING (auth.uid() = id)
   WITH CHECK (auth.uid() = id);
   
   -- Trigger para 'updated_at'
   CREATE OR REPLACE FUNCTION public.handle_updated_at()
   RETURNS TRIGGER AS $$
   BEGIN
     NEW.updated_at = timezone('utc'::text, now());
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;

   DROP TRIGGER IF EXISTS on_usuarios_rotaspeed_updated_at ON public.usuarios_rotaspeed;
   CREATE TRIGGER on_usuarios_rotaspeed_updated_at
   BEFORE UPDATE ON public.usuarios_rotaspeed
   FOR EACH ROW
   EXECUTE FUNCTION public.handle_updated_at();

   -- REMOVA o trigger on_auth_user_created se você estiver usando a Edge Function 'sync-user-profile'
   -- para evitar dupla inserção ou conflitos.
   -- DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
   -- DROP FUNCTION IF EXISTS public.handle_new_user();
   ```
   **Importante:** Se você tinha um trigger `on_auth_user_created` que inseria em `usuarios_rotaspeed`, desative-o ou remova-o para evitar conflitos com a Edge Function `sync-user-profile`.

##### Tabela `entregas`
   Crie uma nova tabela chamada `entregas` para armazenar os detalhes de cada pacote/entrega.

   ```sql
   CREATE TABLE IF NOT EXISTS public.entregas (
       id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
       user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
       created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
       updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
       status text DEFAULT 'pendente'::text NOT NULL, -- pendente, em_rota, entregue, cancelada, nao_entregue
       full_address text NOT NULL,
       street text,
       number text,
       bairro text,
       complemento text,
       cep text,
       city text,
       state text,
       recipient_name text,
       telefone text,
       original_input text,
       input_type text, -- text, photo, voice, pdf, sheet, camera
       optimized_order integer,
       route_id text, -- Alterado para TEXT para maior flexibilidade, ou mantenha UUID se preferir
       delivery_notes text -- Notas do entregador sobre a entrega específica
   );

   -- Políticas RLS para 'entregas'
   ALTER TABLE public.entregas ENABLE ROW LEVEL SECURITY;

   DROP POLICY IF EXISTS "Permitir CRUD completo para proprietário das entregas" ON public.entregas;
   CREATE POLICY "Permitir CRUD completo para proprietário das entregas"
   ON public.entregas
   FOR ALL
   USING (auth.uid() = user_id)
   WITH CHECK (auth.uid() = user_id);

   -- Trigger para 'updated_at' na tabela 'entregas'
   DROP TRIGGER IF EXISTS on_entregas_updated_at ON public.entregas;
   CREATE TRIGGER on_entregas_updated_at
   BEFORE UPDATE ON public.entregas
   FOR EACH ROW
   EXECUTE FUNCTION public.handle_updated_at(); 
   ```

#### d. Supabase Edge Functions

##### `sync-user-profile`
   *   Crie uma nova Edge Function no seu projeto Supabase chamada `sync-user-profile`.
   *   Use o código fornecido em `supabase/functions/sync-user-profile/index.ts`.
   *   **Configuração de Segredos:** Esta função não requer segredos adicionais além do acesso padrão que as Edge Functions têm ao banco de dados do projeto.
   *   **Permissões de Invocação:** Por padrão, as Edge Functions podem ser invocadas por usuários autenticados se você verificar o JWT ou por qualquer pessoa se não houver verificação. O código da função usa o `supabaseServiceRoleClient` para interagir com o banco, o que é seguro.

##### `gemini-proxy`
   *   Siga as instruções no arquivo `supabase/functions/gemini-proxy/index.ts` para implantar a função `gemini-proxy` no seu projeto Supabase `zhjzqrddmigczdfxvfhp`. Configure a variável de ambiente `GEMINI_API_KEY` como um segredo no seu projeto Supabase com sua chave da API Gemini.

##### `reset-daily-counts`
   *   Siga as instruções no arquivo `supabase/functions/reset-daily-counts/index.ts` para implantar a função `reset-daily-counts` no seu projeto Supabase `zhjzqrddmigczdfxvfhp`. Configure as variáveis de ambiente `SUPABASE_URL` (será `https://zhjzqrddmigczdfxvfhp.supabase.co`) e `SUPABASE_SERVICE_ROLE_KEY` como segredos no seu projeto Supabase.

#### e. Cron Job (Agendador) para Reset Diário
   No painel do seu projeto Supabase (`zhjzqrddmigczdfxvfhp`), vá em "Database" -> "Cron Jobs" (ou "Edge Functions" -> "Cron Jobs"). Crie um novo job:
   *   **Name:** `reset-daily-counts-job`
   *   **Schedule (CRON):** `0 0 * * *` (Todo dia à meia-noite UTC)
   *   **Function:** Selecione a função `reset-daily-counts` que você implantou.
   *   **Timeout:** 60 segundos (padrão deve ser suficiente)

### 2. Configuração do Frontend

#### a. Atualize as Configurações do Cliente Supabase
   Abra `supabaseClient.ts`.
   O `supabaseUrl` já deve estar refletindo seu projeto ID (`https://zhjzqrddmigczdfxvfhp.supabase.co`).
   **A chave `supabaseAnonKey` já está preenchida com a chave fornecida para o projeto `zhjzqrddmigczdfxvfhp`.**
   ```typescript
   // Em supabaseClient.ts
   const supabaseUrl: string = 'https://zhjzqrddmigczdfxvfhp.supabase.co'; 
   const supabaseAnonKey: string = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoanpxcmRkbWlnY3pkZnh2ZmhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcyNjM3MDMsImV4cCI6MjA2MjgzOTcwM30.U5l5VEIg4WI7aDS6QbsQRqMAWx6HGgkmDEOObWOnYc8';
   ```

#### b. Atualize a URL do Proxy Gemini
   Abra `geminiService.ts`.
   A `SUPABASE_GEMINI_PROXY_URL` já deve estar refletindo seu projeto ID e a estrutura padrão da função (`https://zhjzqrddmigczdfxvfhp.supabase.co/functions/v1/gemini-proxy`). Verifique se o nome da sua função é exatamente `gemini-proxy`.
   ```typescript
   // Em geminiService.ts
   const SUPABASE_GEMINI_PROXY_URL = 'https://zhjzqrddmigczdfxvfhp.supabase.co/functions/v1/gemini-proxy';
   ```

### 3. Executando o Frontend
1.  Certifique-se de ter as dependências carregadas (TailwindCSS, FontAwesome são via CDN no `index.html`).
2.  Para desenvolvimento local, sirva o `index.html` usando um servidor HTTP (ex: "Live Server" no VS Code, ou `npx serve .`).
3.  Acesse o aplicativo no seu navegador (localmente `http://localhost:<porta>`, ou sua URL de produção `https://aplicativo-iota.vercel.app/`).

## Estrutura do Projeto (Frontend)

*   `index.html`: Ponto de entrada.
*   `index.tsx`: Renderiza o App React.
*   `App.tsx`: Componente raiz, estado principal, roteamento, lógica de plano e autenticação.
*   `types.ts`: Interfaces TypeScript.
*   `uiComponents.tsx`: Componentes de UI.
*   `geminiService.ts`: Comunicação com o backend proxy (`gemini-proxy`).
*   `speechService.ts`: Hook para API de Reconhecimento de Voz.
*   `fileProcessingService.ts`: Utilitários para arquivos.
*   `supabaseClient.ts`: Inicializa o cliente Supabase e helpers.
*   `metadata.json`: Metadados da aplicação.
*   **Componentes de Página:** `LoginPage`, `ResetPasswordPage`, `PackageSetupPage`, `PackageInputPage`, `ManualOrderingPage`, `DeliveryPage`, `CompletedPage`, `SubscriptionInfoPage`, `SettingsPage`, `StatisticsPage`, `HowToUsePage`.
*   `supabase/functions/sync-user-profile/index.ts`: Edge Function para criar/sincronizar perfil do usuário.
*   `supabase/functions/gemini-proxy/index.ts`: Edge Function proxy para API Gemini.
*   `supabase/functions/reset-daily-counts/index.ts`: Edge Function para resetar contagens diárias.

## Como Usar (Resumido)

1.  **Login/Cadastro:** Use email/senha ou Google. Recupere senha se necessário. O perfil é criado/sincronizado automaticamente.
2.  **Painel Principal:** Verifique suas entregas do dia, créditos. Vá para Configurar Entregas.
3.  **Configurar Entregas:** Informe a quantidade de pacotes.
4.  **Adicionar Pacotes:** Use texto, arquivos, câmera ou voz. Pacotes são salvos no Supabase.
5.  **Otimizar Rota:** Escolha otimização automática ou manual.
6.  **Realizar Entregas:** Navegue, marque como "Entregue" ou "Cancelada" (atualiza no Supabase).
7.  **Configurações:** Personalize suas preferências (nome, nome de entregador, etc.).
8.  **Estatísticas:** Acompanhe seu progresso.
9.  **Como Usar:** Consulte as instruções no app.

## Considerações

*   **Chaves Supabase:** Mantenha `SUPABASE_SERVICE_ROLE_KEY` (usada nas Edge Functions `reset-daily-counts` e `sync-user-profile`) segura e configure-a como um segredo no Supabase. `SUPABASE_ANON_KEY` é pública e usada no frontend.
*   **Políticas RLS:** As políticas de Row Level Security são cruciais para a segurança dos dados.
*   **Chave API Gemini:** Configure sua `GEMINI_API_KEY` como um segredo na Edge Function `gemini-proxy`.
*   **Limites da API Gemini:** Monitore o uso.
*   **CORS:** As Edge Functions estão configuradas com CORS (`Access-Control-Allow-Origin: '*'`). Para produção, restrinja para `https://aplicativo-iota.vercel.app`.

Boas entregas!