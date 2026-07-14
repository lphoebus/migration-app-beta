export const rendererOptionsByField = {
  // Counts (magnitude) -> color
  in_n2_: {
    rendererType: "color",
    theme: "high-to-low",
    //schemeName: "Purple 7",
    customStopsByGeo: {
      state: [
        { value: 10000, color: "#eee2cfff", label: "< 10,000" },
        { value: 150000, color: "#aabdb5ff", label: "150,000" },
        { value: 300000, color: "#3b758cff", label: "> 300,000" }
      ],
      county: [
        { value: 0, color: "#eee2cfff", label: "0" },
        { value: 10000, color: "#aabdb5ff", label: "10,000" },
        { value: 20000, color: "#3b758cff", label: "> 20,000" }
      ]
    }
  },
  out_n2_: {
    rendererType: "color",
    theme: "high-to-low",
    //schemeName: "Green 7",
    customStopsByGeo: {
      state: [
        { value: 10000, color: "#efedf5ff", label: "< 10,000" },
        { value: 150000, color: "#bcbddcff", label: "150,000" },
        { value: 300000, color: "#756bb1ff", label: "> 300,000" }
      ],
      county: [
        { value: 0, color: "#efedf5ff", label: "0" },
        { value: 10000, color: "#bcbddcff", label: "10,000" },
        { value: 20000, color: "#756bb1ff", label: "> 20,000" }
      ]
    }
  },

  // Net count -> diverging color
  net_migration_: {
    rendererType: "color",
    theme: "above-and-below",
    //schemeName: "Red and Blue 10",
    customStopsByGeo: {
      state: [
        { value: -75000, color: "#b2182b", label: "< -75,000" },
        { value: 0, color: "#f7f7f7", label: "0" },
        { value: 75000, color: "#2166ac", label: "> 75,000" }
      ],
      county: [
        { value: -1000, color: "#b2182b", label: "< -1,000" },
        { value: 0, color: "#f7f7f7", label: "0" },
        { value: 1000, color: "#2166ac", label: "> 1,000" }
      ]
    }
  },

  // Rates -> color choropleth
  in_: {
    rendererType: "color",
    theme: "high-to-low",
    //schemeName: "Purple 7",
    customStopsByGeo: {
      state: [
        { value: 10, color: "#eee2cfff", label: "< 10" },
        { value: 25, color: "#aabdb5ff", label: "25" },
        { value: 40, color: "#3b758cff", label: "> 40" }
      ],
      county: [
        { value: 25, color: "#eee2cfff", label: "< 25" },
        { value: 50, color: "#aabdb5ff", label: "50" },
        { value: 75, color: "#3b758cff", label: "> 75" }
      ]
    }
  },
  out_: {
    rendererType: "color",
    theme: "high-to-low",
    //schemeName: "Green 7",
    customStopsByGeo: {
      state: [
        { value: 10, color: "#efedf5ff", label: "< 10" },
        { value: 25, color: "#bcbddcff", label: "25" },
        { value: 40, color: "#756bb1ff", label: "> 40" }
      ],
      county: [
        { value: 25, color: "#efedf5ff", label: "< 25" },
        { value: 50, color: "#bcbddcff", label: "50" },
        { value: 75, color: "#756bb1ff", label: "> 75" }
      ]
    }
  },
  net_: {
    rendererType: "color",
    theme: "above-and-below",
    //schemeName: "Red and Blue 10", #850000ff", "#b89fa0ff", "#50567aff"
    customStopsByGeo: {
      state: [
        { value: -10, color: "#850000ff", label: "< -10" },
        { value: 0, color: "rgb(239, 235, 235)", label: "0" },
        { value: 10, color: "#50567aff", label: "> 10" }
      ],
      county: [
        { value: -15, color: "#850000ff", label: "< -15" },
        { value: 0, color: "rgb(205, 197, 197)", label: "0" },
        { value: 15, color: "#50567aff", label: "> 15" }
      ]
    }
  }
};