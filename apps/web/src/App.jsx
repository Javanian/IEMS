import React from 'react';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import router from './router';

function App() {
  return (
    <>
      <RouterProvider
        router={router}
        fallbackElement={
          <div className="flex h-dvh items-center justify-center bg-slate-50 text-sm font-semibold text-slate-600">
            Loading...
          </div>
        }
      />
      <Toaster position="top-right" richColors duration={5000} closeButton expand={false} />
    </>
  );
}

export default App;
