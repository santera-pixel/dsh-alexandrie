// Slot registration + lifecycle. The shell wraps every plugin apply in try/catch, but a
// throwing page blanks the slot anyway, so failures are contained per render too.

function ScriptoriumIcon({ size }) {
  return h(Icon, { name: 'book', size: size || 16 })
}

/** Contain render failures so a bad document cannot blank the whole Harness shell. */
class PanelBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error('[dsh-scriptorium] panel render failed', error)
  }

  render() {
    if (this.state.error === null) return this.props.children
    return h(
      'div',
      { className: 'dsh-scr-empty', style: { height: '100%' } },
      h('div', { className: 'dsh-scr-empty-icon' }, h(Icon, { name: 'warning', size: 22 })),
      h('div', { className: 'dsh-scr-empty-title' }, 'Scriptorium hit an error'),
      h('div', { className: 'dsh-scr-empty-hint' }, String((this.state.error && this.state.error.message) || this.state.error)),
      h(
        'button',
        { type: 'button', className: 'dsh-scr-btn is-primary', onClick: () => this.setState({ error: null }) },
        'Try again',
      ),
    )
  }
}

function ScriptoriumPanel({ store }) {
  return h(
    'div',
    { className: 'dsh-scr-panel', style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
    h(PanelBoundary, null, h(App, { store })),
  )
}

function apply(ctx) {
  const store = createStore()
  const disposers = []
  const styleText = BASE_CSS + '\n' + CSS_CHUNKS.join('\n')

  const insertStyle = () => {
    const element = document.createElement('style')
    element.setAttribute('data-plugin', PANEL_ID)
    element.textContent = styleText
    document.head.appendChild(element)
    return () => {
      if (element.parentNode) element.parentNode.removeChild(element)
    }
  }

  try {
    disposers.push(insertStyle())
  } catch (error) {
    console.error('[dsh-scriptorium] could not inject styles', error)
  }

  const slots = ctx.get('slots')
  if (slots === undefined || slots === null) {
    console.warn('[dsh-scriptorium] slots service is unavailable; the panel cannot mount')
    return
  }

  const Panel = () => h(ScriptoriumPanel, { store })

  try {
    disposers.push(slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, Panel)))
    disposers.push(
      slots.inject('sidebar.panellist', () =>
        slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: () => 'Scriptorium' }, ScriptoriumIcon),
      ),
    )
  } catch (error) {
    console.error('[dsh-scriptorium] slot registration failed', error)
  }

  void store.load()

  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch (error) {
        console.error('[dsh-scriptorium] dispose failed', error)
      }
    }
    store.dispose()
  }, 'dsh-scriptorium: client')
}
