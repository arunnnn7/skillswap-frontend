import React, { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import KnowledgeSVG from '../assets/knowledge-circle.svg'

export default function Home(){
  const nav = useNavigate()
  const loc = useLocation()

  useEffect(()=>{
    // If URL hash is #how or fragment was provided, scroll to the How it works section
    if (loc.hash === '#how' || window.location.hash === '#how'){
      const el = document.getElementById('how-it-works')
      if (el) setTimeout(()=>el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    }
  }, [loc])
  return (
    <div className="min-h-screen flex flex-col bg-warmbg">
      <main className="flex-1 pt-24">
        <section className="max-w-7xl mx-auto px-6 py-16 grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h1 className="text-4xl md:text-6xl font-display text-navy leading-tight mb-4">Learn. Share. Grow Together.</h1>
            <p className="text-lg text-navy/80 mb-6">Trade your expertise with a global community. No money, just mutual growth.</p>
            <div className="flex gap-4 items-center">
              <button onClick={()=>nav('/find')} className="px-6 py-3 rounded-lg bg-coral text-white shadow card btn-transition">Find a Skill</button>
              <button onClick={()=>nav('/signup')} className="px-6 py-3 rounded-lg border border-navy text-navy btn-transition">Offer a Skill</button>
              {localStorage.getItem('token') && (
                <button onClick={()=>nav('/dashboard')} className="px-5 py-2 rounded-lg bg-navy text-white btn-transition">Go to Dashboard</button>
              )}
            </div>
          </div>
          <div className="flex items-center justify-center">
            <div className="w-full max-w-xl">
              <img src={KnowledgeSVG} alt="Knowledge Circle illustration" className="w-full h-auto rounded-xl shadow" />
            </div>
          </div>
        </section>

  <section id="how-it-works" className="py-12 bg-white">
          <div className="max-w-5xl mx-auto text-center">
            <h2 className="text-2xl font-semibold text-navy mb-6">How it works</h2>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="p-6 card rounded-lg">
                <div className="text-3xl mb-4">👤</div>
                <h4 className="font-semibold mb-2">Create Your Profile</h4>
                <p className="text-sm text-navy/70">List the skills you offer and the skills you want to learn.</p>
              </div>
              <div className="p-6 card rounded-lg">
                <div className="text-3xl mb-4">🔍</div>
                <h4 className="font-semibold mb-2">Find Your Match</h4>
                <p className="text-sm text-navy/70">Browse and search partners by skills, location, or availability.</p>
              </div>
              <div className="p-6 card rounded-lg">
                <div className="text-3xl mb-4">🔁</div>
                <h4 className="font-semibold mb-2">Connect & Swap</h4>
                <p className="text-sm text-navy/70">Chat securely and schedule your first skill-swap session.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="py-12">
          <div className="max-w-6xl mx-auto px-6">
            <h3 className="text-xl font-semibold text-navy mb-4">Popular Skills Right Now</h3>
            <div className="flex flex-wrap gap-3">
              {['Web Development','Graphic Design','Spanish Language','Guitar Lessons','Public Speaking'].map(s=> (
                <div key={s} className="px-4 py-2 rounded-full bg-white card text-navy hover:shadow-md btn-transition">{s}</div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-12 bg-white">
          <div className="max-w-3xl mx-auto text-center">
            <blockquote className="text-lg italic text-navy/80">"I taught web design and learned how to bake sourdough! SkillSwap changed how I learn new things."</blockquote>
            <cite className="block mt-4 font-semibold text-navy">- Rithanya S</cite>
          </div>
        </section>

        <section className="py-12 bg-navy text-white">
          <div className="max-w-7xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center justify-between">
            <div>
              <h3 className="text-2xl font-semibold">Ready to Share Your Skills?</h3>
              <p className="text-white/80 text-sm">Join a community of learners and teachers.</p>
            </div>
            <div>
              <button onClick={()=>nav('/signup')} className="px-6 py-3 rounded-md bg-coral text-white btn-transition">Join the Community</button>
            </div>
          </div>
        </section>

        <footer className="py-6 text-center text-sm text-navy/70">About · Contact · Privacy · Terms</footer>
      </main>
    </div>
  )
}
