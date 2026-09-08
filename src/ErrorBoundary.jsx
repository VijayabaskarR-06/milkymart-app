import { Component } from 'react'

// Last line of defence: a render crash anywhere below this shows a recovery
// screen instead of an empty white page. "Reset app data" exists because the
// most likely cause of an unrecoverable render is state restored from storage.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Milky Mart crashed:', error, info?.componentStack)
  }

  handleReload = () => {
    window.location.reload()
  }

  handleReset = () => {
    try {
      Object.keys(localStorage)
        .filter((key) => key.startsWith('milky-mart-'))
        .forEach((key) => localStorage.removeItem(key))
    } catch {
      // Nothing else we can do — fall through to the reload.
    }
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main className="browser-stage">
        <div className="app-frame">
          <section className="crash-screen" role="alert">
            <span className="crash-mark">!</span>
            <h1>Something went wrong</h1>
            <p>The app hit an unexpected error. Your saved data is still on this device.</p>
            <pre>{String(this.state.error?.message || this.state.error)}</pre>
            <button className="primary-button" onClick={this.handleReload}>Reload the app</button>
            <button className="crash-reset" onClick={this.handleReset}>Reset app data and reload</button>
          </section>
        </div>
      </main>
    )
  }
}

export default ErrorBoundary
