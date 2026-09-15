import React, { useState } from "react";

export default {
  apiVersion: 1,
  rankers: {
    "fixture.reverse": context => [...context.defaults.rank(context)].reverse(),
  },
  layouts: {
    "fixture.offset": context => {
      const result = context.defaults.layout(context);
      return {
        ...result,
        cards: result.cards.map((card, index) => ({ ...card, x: card.x + index * 37, y: card.y + index * 19 })),
      };
    },
  },
  cards: {
    "fixture.hooked-card": function HookedCard(props) {
      const [count, setCount] = useState(0);
      return <div data-fixture-card={props.card.id} style={{ position: "relative", height: "100%" }}>
        <button type="button" data-fixture-hook style={{ position: "absolute", zIndex: 2, right: 8, top: 8 }} onClick={() => setCount(value => value + 1)}>Hook count {count}</button>
        <props.DefaultCard {...props} />
      </div>;
    },
  },
  views: {
    "fixture.audit-view": function AuditView({ catalog, view, onSelect }) {
      const [count, setCount] = useState(0);
      const components = catalog.assets.filter(asset => asset.kind === "component");
      return <section data-fixture-view>
        <h2>{view.title}: {components.length} components</h2>
        <button type="button" onClick={() => setCount(value => value + 1)}>View hook {count}</button>
        {components.map(component => <button type="button" key={component.id} onClick={() => onSelect(component.id)}>{component.label}</button>)}
      </section>;
    },
  },
};
