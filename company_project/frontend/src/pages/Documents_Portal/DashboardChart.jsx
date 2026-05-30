import { useEffect, useState } from "react";
import axios from "axios";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
} from "chart.js";

import { Bar } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

const colors = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444"];

function DashboardChart({ chartFilter }) {

  const [chartData, setChartData] = useState([]);

  const loadData = async () => {
    const res = await axios.get(
      "http://localhost:8080/api/documents",
      {
        params: {
          fromDate: chartFilter.fromDate || null,
          toDate: chartFilter.toDate || null
        }
      }
    );

    setChartData(res.data);
  };

  useEffect(() => {
    loadData();
  }, [chartFilter]);

  // group by enteredBy (IMPORTANT FIX)
  const grouped = chartData.reduce((acc, item) => {
    acc[item.enteredBy] = (acc[item.enteredBy] || 0) + 1;
    return acc;
  }, {});

  const data = {
    labels: Object.keys(grouped),
    datasets: [
      {
        label: "Documents Count",
        data: Object.values(grouped),
        backgroundColor: Object.keys(grouped).map(
          (_, i) => colors[i % colors.length]
        )
      }
    ]
  };

  return (
    <div>
      <h2>Documents Entered By User</h2>
      <Bar data={data} />
    </div>
  );
}



export default DashboardChart;