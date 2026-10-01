import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { UserProvider } from '@/hooks/useCurrentUser';
import { ThemeProvider } from '@/hooks/useTheme';
import App from '@/App';
import '@/index.css';
import { ToastProvider } from '@/components/feedback/ToastProvider';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Supabase Realtime invalidates these on change; a short stale window
      // keeps the UI responsive without serving obviously old data.
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <UserProvider>
          <ThemeProvider>
            <TooltipProvider>
              <ToastProvider><App /></ToastProvider>
            </TooltipProvider>
          </ThemeProvider>
        </UserProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
