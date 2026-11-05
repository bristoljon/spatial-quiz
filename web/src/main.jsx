import React from 'react';
import { createRoot } from 'react-dom/client';
import Host from './pages/Host.jsx';
import Player from './pages/Player.jsx';
import './styles.css';

const isHost = window.location.pathname.replace(/\/+$/, '') === '/host';
createRoot(document.getElementById('root')).render(
  <React.StrictMode>{isHost ? <Host /> : <Player />}</React.StrictMode>,
);
