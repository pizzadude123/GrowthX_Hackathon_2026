import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import App from './App';
import './styles.css';
import {WHITEBOX_RELEASE_SOURCE_DIGEST} from './release-identity';

const productionConvexUrl='https://fleet-pony-54.convex.cloud';
document.documentElement.dataset.whiteboxReleaseSource=WHITEBOX_RELEASE_SOURCE_DIGEST;
const url=import.meta.env.PROD?productionConvexUrl:import.meta.env.VITE_CONVEX_URL as string|undefined;
const root=ReactDOM.createRoot(document.getElementById('root')!);
root.render(<React.StrictMode><BrowserRouter>{url?<ConvexProvider client={new ConvexReactClient(url)}><App configured/></ConvexProvider>:<App configured={false}/>}</BrowserRouter></React.StrictMode>);
