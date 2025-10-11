import React, { createContext, useContext, useState } from 'react'

const ToastContext = createContext()

export function useToast(){
  return useContext(ToastContext)
}

export function ToastProvider({ children }){
  const [toasts, setToasts] = useState([])

  function show(message, type='info', timeout=4000){
    const id = Date.now().toString()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(()=> setToasts(prev => prev.filter(t => t.id !== id)), timeout)
  }

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-6 right-6 space-y-2 z-50">
        {toasts.map(t => (
          <div key={t.id} className={`px-4 py-2 rounded shadow-lg text-white ${t.type==='success'? 'bg-emerald-500' : t.type==='error'? 'bg-red-500' : 'bg-gray-700'}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
