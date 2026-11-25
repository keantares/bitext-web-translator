import { render } from 'preact';
import '../../styles/tokens.css';
import { App } from './App';

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}
