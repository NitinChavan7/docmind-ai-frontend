import { Component } from 'react';
import { BookOpen, RotateCcw } from 'lucide-react';

export default class ChatErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (!this.state.failed) return this.props.children;
    return <aside className="chat-panel chat-recovery" role="alert">
      <span className="assistant-icon"><BookOpen size={25}/></span>
      <h3>Let's bring your conversation back.</h3>
      <p>There was a problem displaying the chat. Your PDF and saved messages are still here.</p>
      <button onClick={() => this.setState({ failed: false })}><RotateCcw size={15}/> Try again</button>
    </aside>;
  }
}
