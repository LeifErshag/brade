import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import { AuthProvider } from "./AuthContext.jsx";
import { I18nProvider } from "./i18n/I18nContext.jsx";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { installGlobalErrorHandlers } from "./remoteLog.js";

installGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <I18nProvider>
      <ErrorBoundary>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </I18nProvider>
  </React.StrictMode>
);
