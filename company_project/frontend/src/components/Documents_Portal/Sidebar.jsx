const Sidebar = ({ setSelectedType }) => {

  const menus = [
    "Summary",
    "Commercial",
    "Balance",
    "Cost Center",
    "Domestic",
    "Sales Order"
  ];

  return (

    <div
      style={{
        width: "250px",
        background: "#1e293b",
        color: "white",
        minHeight: "100vh",
        padding: "20px"
      }}
    >

      <h2>WareHouse Time Tracker System</h2>

      {menus.map(menu => (

        <button
          key={menu}
          onClick={() => setSelectedType(menu)}
          style={{
            display: "block",
            width: "100%",
            padding: "12px",
            marginTop: "10px",
            background: "#334155",
            color: "white",
            border: "none",
            cursor: "pointer"
          }}
        >
          {menu}
        </button>

      ))}

    </div>
  );
};

export default Sidebar;