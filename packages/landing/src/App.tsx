import { Nav } from './components/Nav'
import { Hero } from './components/Hero'
import { Primitives } from './components/Primitives'
import { Beliefs } from './components/Beliefs'
import { Proof } from './components/Proof'
import { Footer } from './components/Footer'

export function App() {
  return (
    <>
      <Nav />
      <main id="top">
        <Hero />
        <Primitives />
        <Beliefs />
        <Proof />
      </main>
      <Footer />
    </>
  )
}
